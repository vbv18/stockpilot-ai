import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { getEnv } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

/**
 * Returns a configured LangChain ChatModel from env
 */
export function getChatModel() {
  const env = getEnv();

  if (!env.LLM_PROVIDER || !env.LLM_API_KEY) {
    throw new AppError("SERVICE_UNAVAILABLE", "AI analysis is not configured.");
  }

  const temperature = env.LLM_TEMPERATURE ?? 0.1;
  const maxTokens = env.LLM_MAX_OUTPUT_TOKENS ?? 2048;

  if (env.LLM_PROVIDER === "gemini") {
    return new ChatGoogleGenerativeAI({
      model: env.LLM_MODEL || "gemini-1.5-pro",
      apiKey: env.LLM_API_KEY,
      temperature,
      maxOutputTokens: maxTokens,
    });
  }

  if (env.LLM_PROVIDER === "groq" || env.LLM_PROVIDER === "openai") {
    const configuration =
      env.LLM_PROVIDER === "groq"
        ? { baseURL: "https://api.groq.com/openai/v1" }
        : undefined;
    return new ChatOpenAI({
      model:
        env.LLM_MODEL ||
        (env.LLM_PROVIDER === "groq" ? "llama-3.3-70b-versatile" : "gpt-4o"),
      apiKey: env.LLM_API_KEY,
      temperature,
      maxTokens,
      configuration,
    });
  }

  if (env.LLM_PROVIDER === "anthropic") {
    return new ChatAnthropic({
      model: env.LLM_MODEL || "claude-3-5-sonnet-20241022",
      apiKey: env.LLM_API_KEY,
      temperature,
      maxTokens,
    });
  }

  throw new AppError("SERVICE_UNAVAILABLE", "AI analysis is not configured.");
}
