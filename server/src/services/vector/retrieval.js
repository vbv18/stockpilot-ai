import { AppError } from "../../lib/errors.js";
import { getEmbedder } from "./embeddings.js";
import { search } from "./qdrantStore.js";

/**
 * Semantic retrieval for a session, strictly scoped to user and session
 *
 * @param {Object} args
 * @param {string} args.userId
 * @param {string} args.sessionId
 * @param {string} args.query
 * @param {number} [args.limit=8]
 * @param {string} [args.skuId]
 * @returns {Promise<Array<{ score: number, artifactType: string, artifactId: string, skuId: string|null, text: string }>>}
 */
export async function searchSession({ userId, sessionId, query, limit = 8, skuId }) {
  const embedder = getEmbedder();
  if (!embedder) {
    throw new AppError("UPSTREAM_VECTOR_ERROR", "Semantic retrieval is unavailable.", {
      retryable: true,
    });
  }

  const queryVector = await embedder.embedQuery(query);

  const hits = await search({
    userId,
    sessionId,
    vector: queryVector,
    limit,
    skuId,
  });

  return hits.map((hit) => ({
    score: hit.score,
    artifactType: hit.payload?.artifact_type,
    artifactId: hit.payload?.artifact_id,
    skuId: hit.payload?.sku_id || null,
    text: hit.payload?.text || "",
  }));
}
