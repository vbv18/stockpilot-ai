import { QdrantClient } from "@qdrant/js-client-rest";
import { getEnv } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

export const COLLECTION_NAME = "stockpilot_session_artifacts";

let client = null;
let collectionEnsured = false;

function getClient() {
  if (!client) {
    const env = getEnv();
    client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY || undefined,
      checkCompatibility: false,
    });
  }
  return client;
}

/**
 * Ensures collection exists with given dimension and indexes.
 */
export async function ensureCollection(dim) {
  if (collectionEnsured) return;
  const qdrant = getClient();

  try {
    const collectionsRes = await qdrant.getCollections();
    const exists = collectionsRes.collections.some(
      (c) => c.name === COLLECTION_NAME,
    );

    if (!exists) {
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: {
          size: dim,
          distance: "Cosine",
        },
      });

      // Create keyword payload indexes for filtering
      const indexFields = ["user_id", "session_id", "artifact_type", "sku_id"];
      for (const field of indexFields) {
        try {
          await qdrant.createPayloadIndex(COLLECTION_NAME, {
            field_name: field,
            field_schema: "keyword",
            wait: true,
          });
        } catch (idxErr) {
          console.warn("Could not create payload index (may exist)", {
            field,
            err: idxErr.message,
          });
        }
      }
    } else {
      const info = await qdrant.getCollection(COLLECTION_NAME);
      const vectorSize = info.config?.params?.vectors?.size;
      if (vectorSize && vectorSize !== dim) {
        throw new AppError(
          "UPSTREAM_VECTOR_ERROR",
          "Vector collection dimension mismatch",
        );
      }
    }

    collectionEnsured = true;
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("Failed to ensure Qdrant collection", { err: err.message });
    throw new AppError(
      "UPSTREAM_VECTOR_ERROR",
      "Semantic retrieval is unavailable.",
      {
        retryable: true,
      },
    );
  }
}

/**
 * Upsert points in batches of 64
 */
export async function upsertPoints(points) {
  if (!points || points.length === 0) return;
  const qdrant = getClient();
  const batchSize = 64;

  try {
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await qdrant.upsert(COLLECTION_NAME, {
        wait: true,
        points: batch,
      });
    }
  } catch (err) {
    console.error("Failed to upsert points in Qdrant", { err: err.message });
    throw new AppError(
      "UPSTREAM_VECTOR_ERROR",
      "Semantic retrieval is unavailable.",
      {
        retryable: true,
      },
    );
  }
}

/**
 * Delete stale points for a session where content_version != keepVersion
 */
export async function deleteStale(userId, sessionId, keepVersion) {
  const qdrant = getClient();
  try {
    await qdrant.delete(COLLECTION_NAME, {
      wait: true,
      filter: {
        must: [
          { key: "user_id", match: { value: userId } },
          { key: "session_id", match: { value: sessionId } },
        ],
        must_not: [{ key: "content_version", match: { value: keepVersion } }],
      },
    });
  } catch (err) {
    console.warn("Failed to delete stale points in Qdrant", {
      err: err.message,
      sessionId,
    });
  }
}

/**
 * Delete all points for a session
 */
export async function deleteSession(userId, sessionId) {
  const qdrant = getClient();
  try {
    await qdrant.delete(COLLECTION_NAME, {
      wait: true,
      filter: {
        must: [
          { key: "user_id", match: { value: userId } },
          { key: "session_id", match: { value: sessionId } },
        ],
      },
    });
  } catch (err) {
    console.error("Failed to delete session points in Qdrant", {
      err: err.message,
      sessionId,
    });
    throw new AppError(
      "UPSTREAM_VECTOR_ERROR",
      "Semantic retrieval is unavailable.",
      {
        retryable: true,
      },
    );
  }
}

/**
 * Search Qdrant filtering strictly by user_id and session_id
 */
export async function search({ userId, sessionId, vector, limit = 8, skuId }) {
  const qdrant = getClient();

  const mustConditions = [
    { key: "user_id", match: { value: userId } },
    { key: "session_id", match: { value: sessionId } },
  ];
  if (skuId) {
    mustConditions.push({ key: "sku_id", match: { value: skuId } });
  }

  try {
    const results = await qdrant.query(COLLECTION_NAME, {
      query: vector,
      limit,
      filter: {
        must: mustConditions,
      },
      with_payload: true,
    });

    const points = results.points || results || [];
    return points.map((r) => ({
      score: r.score,
      payload: r.payload,
    }));
  } catch (err) {
    console.error("Failed to search points in Qdrant", {
      err: err.message,
      sessionId,
    });
    throw new AppError(
      "UPSTREAM_VECTOR_ERROR",
      "Semantic retrieval is unavailable.",
      {
        retryable: true,
      },
    );
  }
}
