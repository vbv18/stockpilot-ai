import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { getEnv } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

let verifiedEmbedderInstance = null;

/**
 * Returns the Embedder instance, or null if EMBEDDING_PROVIDER is unset.
 */
export function getEmbedder() {
  if (verifiedEmbedderInstance) {
    return verifiedEmbedderInstance;
  }

  const env = getEnv();
  if (!env.EMBEDDING_PROVIDER || !env.EMBEDDING_API_KEY) {
    return null;
  }

  const dim = env.EMBEDDING_DIM ? Number(env.EMBEDDING_DIM) : 768;

  let instance = null;
  if (env.EMBEDDING_PROVIDER === "gemini") {
    const raw = new GoogleGenerativeAIEmbeddings({
      model: env.EMBEDDING_MODEL || "text-embedding-004",
      apiKey: env.EMBEDDING_API_KEY,
    });
    instance = {
      dim,
      embedDocuments: (texts) => raw.embedDocuments(texts),
      embedQuery: (text) => raw.embedQuery(text),
    };
  } else if (env.EMBEDDING_PROVIDER === "openai") {
    const raw = new OpenAIEmbeddings({
      model: env.EMBEDDING_MODEL || "text-embedding-3-small",
      apiKey: env.EMBEDDING_API_KEY,
      dimensions: dim,
    });
    instance = {
      dim,
      embedDocuments: (texts) => raw.embedDocuments(texts),
      embedQuery: (text) => raw.embedQuery(text),
    };
  }

  verifiedEmbedderInstance = instance;
  return verifiedEmbedderInstance;
}

/**
 * Verifies embedder output dimension against EMBEDDING_DIM
 */
export async function verifyEmbedderDim(e) {
  const probe = await e.embedQuery("probe");
  const env = getEnv();
  const expectedDim = env.EMBEDDING_DIM ? Number(env.EMBEDDING_DIM) : e.dim;
  if (probe.length !== expectedDim) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      `EMBEDDING_DIM does not match the embedding model output (${probe.length})`,
    );
  }
}
