import { v5 as uuidv5 } from "uuid";
import { AnalysisSessionModel } from "../../models/analysisSession.model.js";
import { loadSessionBundle } from "../ai/sessionBundle.js";
import { buildArtifactDocs } from "./artifacts.js";
import { getEmbedder, verifyEmbedderDim } from "./embeddings.js";
import { deleteStale, ensureCollection, upsertPoints } from "./qdrantStore.js";

const UUID_NAMESPACE = "6f1d1b0e-8d0c-4f57-9d63-5d6f3f0f9a11";

// In-memory debounce and concurrency tracker
const pendingTimers = new Map();
const runningSessions = new Set();
const rerunRequested = new Set();

/**
 * Debounced trigger for session reindexing (500ms). Never throws.
 */
export function scheduleReindex(userId, sessionId, reason) {
  try {
    const key = `${userId}:${sessionId}`;
    if (pendingTimers.has(key)) {
      clearTimeout(pendingTimers.get(key));
    }

    const timer = setTimeout(() => {
      pendingTimers.delete(key);
      reindexSession(userId, sessionId, reason).catch((err) => {
        console.error("Background reindex failed", {
          userId,
          sessionId,
          err: err.message,
        });
      });
    }, 500);

    pendingTimers.set(key, timer);
  } catch (err) {
    console.warn("Error in scheduleReindex", {
      userId,
      sessionId,
      err: err.message,
    });
  }
}

/**
 * Full reindexing routine for a session
 */
export async function reindexSession(userId, sessionId, reason) {
  const sessionKey = `${userId}:${sessionId}`;

  if (runningSessions.has(sessionKey)) {
    rerunRequested.add(sessionKey);
    return;
  }

  runningSessions.add(sessionKey);

  try {
    // 1. Set session.aiIndex.status = "pending"
    await AnalysisSessionModel.updateOne(
      { _id: sessionId, userId },
      {
        $set: {
          "aiIndex.status": "pending",
          "aiIndex.errorMessage": null,
        },
      },
    );

    // 2. Check embedder
    const embedder = getEmbedder();
    if (!embedder) {
      console.log("Embedder not configured; skipping AI index", { sessionId });
      await AnalysisSessionModel.updateOne(
        { _id: sessionId, userId },
        {
          $set: {
            "aiIndex.status": "skipped",
            "aiIndex.updatedAt": new Date(),
          },
        },
      );
      return;
    }

    // Verify dimension
    try {
      await verifyEmbedderDim(embedder);
    } catch (dimErr) {
      console.error("Embedder verification failed", { err: dimErr.message });
      await AnalysisSessionModel.updateOne(
        { _id: sessionId, userId },
        {
          $set: {
            "aiIndex.status": "failed",
            "aiIndex.errorMessage": dimErr.message.slice(0, 200),
            "aiIndex.updatedAt": new Date(),
          },
        },
      );
      return;
    }

    // 3. Load bundle
    const bundle = await loadSessionBundle(userId, sessionId);
    if (!bundle.forecastRun) {
      await AnalysisSessionModel.updateOne(
        { _id: sessionId, userId },
        {
          $set: {
            "aiIndex.status": "skipped",
            "aiIndex.updatedAt": new Date(),
          },
        },
      );
      return;
    }

    // 4. Build artifact docs
    const artifactDocs = buildArtifactDocs(bundle);
    if (artifactDocs.length === 0) {
      await AnalysisSessionModel.updateOne(
        { _id: sessionId, userId },
        {
          $set: {
            "aiIndex.status": "skipped",
            "aiIndex.updatedAt": new Date(),
          },
        },
      );
      return;
    }

    // 5. Version timestamp
    const version = Date.now();

    // 6. Embed in batches of 16
    const texts = artifactDocs.map((d) => d.text);
    const vectors = [];
    const batchSize = 16;
    for (let i = 0; i < texts.length; i += batchSize) {
      const textBatch = texts.slice(i, i + batchSize);
      const batchVectors = await embedder.embedDocuments(textBatch);
      vectors.push(...batchVectors);
    }

    // 7. Ensure collection
    await ensureCollection(embedder.dim);

    // 8. Build Qdrant points with deterministic IDs
    const nowIso = new Date().toISOString();
    const points = artifactDocs.map((doc, idx) => {
      const rawId = `${sessionId}|${doc.artifactType}|${doc.artifactId}|${doc.skuId || ""}`;
      const pointId = uuidv5(rawId, UUID_NAMESPACE);
      return {
        id: pointId,
        vector: vectors[idx],
        payload: {
          user_id: userId,
          session_id: sessionId,
          artifact_type: doc.artifactType,
          artifact_id: doc.artifactId,
          sku_id: doc.skuId,
          content_version: version,
          created_at: nowIso,
          text: doc.text,
        },
      };
    });

    await upsertPoints(points);

    // 9. Delete stale points
    await deleteStale(userId, sessionId, version);

    // 10. Update session state to indexed
    await AnalysisSessionModel.updateOne(
      { _id: sessionId, userId },
      {
        $set: {
          "aiIndex.status": "indexed",
          "aiIndex.contentVersion": version,
          "aiIndex.errorMessage": null,
          "aiIndex.updatedAt": new Date(),
        },
      },
    );

    console.log("Session reindexed successfully", {
      sessionId,
      pointsCount: points.length,
      version,
    });
  } catch (err) {
    console.error("Error during session reindex", {
      sessionId,
      err: err.message,
    });
    await AnalysisSessionModel.updateOne(
      { _id: sessionId, userId },
      {
        $set: {
          "aiIndex.status": "failed",
          "aiIndex.errorMessage": (err.message || "Indexing failed").slice(
            0,
            200,
          ),
          "aiIndex.updatedAt": new Date(),
        },
      },
    );
  } finally {
    runningSessions.delete(sessionKey);
    if (rerunRequested.has(sessionKey)) {
      rerunRequested.delete(sessionKey);
      reindexSession(userId, sessionId, "rerun_after_finish").catch((err) => {
        console.error("Follow-up reindex failed", {
          userId,
          sessionId,
          err: err.message,
        });
      });
    }
  }
}
