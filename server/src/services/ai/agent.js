import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AssistantDraft,
  AssistantResponse,
  TOOL_INPUT_SCHEMAS,
  TOOL_NAMES,
} from "../../contracts/ai.js";
import { AppError } from "../../lib/errors.js";
import { WhatIfRunModel } from "../../models/whatIfRun.model.js";
import { buildSessionRisk } from "../risk.js";
import { searchSession } from "../vector/retrieval.js";
import { buildSessionDigest, loadCanonicalForHit } from "./canonical.js";
import { groundDraft } from "./grounding.js";
import { EvidenceLedger } from "./ledger.js";
import { getChatModel } from "./llm.js";
import { COMPOSE_INSTRUCTION, SYSTEM_PROMPT } from "./prompts.js";
import { loadSessionBundle } from "./sessionBundle.js";
import { compareInventoryPolicies } from "./tools/compareInventoryPolicies.js";
import { getInventoryRecommendation } from "./tools/getInventoryRecommendation.js";
import { getInventoryRiskSummary } from "./tools/getInventoryRiskSummary.js";
import { getSkuForecast } from "./tools/getSkuForecast.js";
import { runWhatIfScenario } from "./tools/runWhatIfScenario.js";
import { getPortfolioPlan } from "./tools/getPortfolioPlan.js";
import { getModelComparison } from "./tools/getModelComparison.js";

const MAX_TOOL_STEPS = 6;
const MAX_TOTAL_TOOL_CALLS = 8;

export async function runAgent(input) {
  const {
    userId,
    sessionId,
    conversationId,
    requestId,
    signal,
    question,
    history = [],
  } = input;
  const startTime = Date.now();

  const ledger = new EvidenceLedger();
  const toolTrace = [];
  const extraWarnings = [];
  let totalToolExecutions = 0;
  let toolStepsCount = 0;

  // Tool dispatch table
  const toolHandlers = {
    get_sku_forecast: getSkuForecast,
    get_inventory_recommendation: getInventoryRecommendation,
    compare_inventory_policies: compareInventoryPolicies,
    run_what_if_scenario: runWhatIfScenario,
    get_inventory_risk_summary: getInventoryRiskSummary,
    get_portfolio_plan: getPortfolioPlan,
    get_model_comparison: getModelComparison,
  };

  // LangChain tool wrappers
  const toolDefs = [
    tool(async (args) => JSON.stringify(args), {
      name: "get_sku_forecast",
      description:
        "Get SKU demand forecast, prediction intervals and holdout metrics.",
      schema: TOOL_INPUT_SCHEMAS.get_sku_forecast,
    }),
    tool(async (args) => JSON.stringify(args), {
      name: "get_inventory_recommendation",
      description:
        "Get EOQ, deterministic and uncertainty-aware ROP recommendations for a SKU.",
      schema: TOOL_INPUT_SCHEMAS.get_inventory_recommendation,
    }),
    tool(async (args) => JSON.stringify(args), {
      name: "compare_inventory_policies",
      description:
        "Compare deterministic vs uncertainty-aware policy outcomes across simulation scenarios.",
      schema: TOOL_INPUT_SCHEMAS.compare_inventory_policies,
    }),
    tool(async (args) => JSON.stringify(args), {
      name: "run_what_if_scenario",
      description:
        "Simulate a what-if inventory scenario under overridden cost, lead time, or service level assumptions.",
      schema: TOOL_INPUT_SCHEMAS.run_what_if_scenario,
    }),
    tool(async (args) => JSON.stringify(args), {
      name: "get_inventory_risk_summary",
      description:
        "Rank and summarize SKUs by stockout risk, uncertainty gap and risk flags.",
      schema: TOOL_INPUT_SCHEMAS.get_inventory_risk_summary,
    }),
    tool(async (args) => JSON.stringify(args), {
      name: "get_portfolio_plan",
      description:
        "Get portfolio optimization plan under budget and capacity constraints, comparing unconstrained vs constrained service levels and ROPs.",
      schema: TOOL_INPUT_SCHEMAS.get_portfolio_plan,
    }),
    tool(async (args) => JSON.stringify(args), {
      name: "get_model_comparison",
      description:
        "Get rolling backtest evaluation metrics and chosen model comparisons across AutoETS, SeasonalNaive, and CrostonSBA.",
      schema: TOOL_INPUT_SCHEMAS.get_model_comparison,
    }),
  ];

  let bundle;
  let knownSkuIds = [];

  // Define Graph State Annotation
  const GraphAnnotation = Annotation.Root({
    messages: Annotation({
      reducer: (x, y) => x.concat(y),
      default: () => [],
    }),
    stepCount: Annotation({
      reducer: (x, y) => y,
      default: () => 0,
    }),
  });

  // 1. Prepare Node
  async function prepareNode() {
    if (signal?.aborted)
      throw new AppError("JOB_CANCELLED", "The operation was cancelled.");

    bundle = await loadSessionBundle(userId, sessionId);

    let risks = null;
    if (bundle.optimizationRun) {
      try {
        risks = buildSessionRisk(
          bundle.optimizationRun,
          bundle.simulationRun,
          bundle.assumptions,
        );
      } catch {
        risks = [];
      }
    }

    const digest = buildSessionDigest(bundle, risks);
    ledger.addDigest(sessionId, digest);

    knownSkuIds = digest.skus ? digest.skus.map((s) => s.skuId) : [];

    // Find mentioned SKUs
    const lowerQ = question.toLowerCase();
    const mentionedSkus = knownSkuIds.filter((sku) => {
      const reg = new RegExp(`\\b${sku}\\b`, "i");
      return reg.test(lowerQ);
    });

    // Retrieval
    let searchHits = [];
    try {
      const mainHits = await searchSession({
        userId,
        sessionId,
        query: question,
        limit: 8,
      });
      searchHits.push(...mainHits);

      for (const skuId of mentionedSkus.slice(0, 3)) {
        const skuHits = await searchSession({
          userId,
          sessionId,
          query: question,
          limit: 4,
          skuId,
        });
        searchHits.push(...skuHits);
      }
    } catch {
      extraWarnings.push(
        "Semantic retrieval is unavailable; this answer uses the structured session summary and calculation tools only.",
      );
    }

    // Dedupe hits
    const seenHits = new Set();
    const dedupedHits = [];
    for (const hit of searchHits) {
      const key = `${hit.artifactType}|${hit.artifactId}|${hit.skuId || ""}`;
      if (!seenHits.has(key)) {
        seenHits.add(key);
        dedupedHits.push(hit);
      }
    }

    // Add canonical payloads into evidence ledger
    const retrievedEvidenceBlocks = [];
    for (const hit of dedupedHits) {
      const canonical = loadCanonicalForHit(bundle, hit);
      if (canonical) {
        const entry = ledger.add({
          artifactType: canonical.artifactType,
          artifactId: canonical.artifactId,
          skuId: canonical.skuId,
          source: "retrieval",
          toolName: null,
          payload: canonical.payload,
          label: canonical.label,
        });

        retrievedEvidenceBlocks.push(
          `RETRIEVED EVIDENCE (evidence ${entry.evidenceId}):\n<untrusted_data>\n${hit.text}\ncanonical: ${JSON.stringify(canonical.payload)}\n</untrusted_data>`,
        );
      }
    }

    // Context blocks
    const contextLines = [
      `CONTEXT:`,
      `Session ID: ${sessionId}`,
      `Session Name: "${bundle.session.name}"`,
      `Status: ${bundle.session.status}`,
      `Today's Date: ${new Date().toISOString().slice(0, 10)}`,
      `SKUs in session (${knownSkuIds.length}): ${knownSkuIds.slice(0, 50).join(", ")}`,
      ``,
      `SESSION DIGEST (evidence E0):`,
      JSON.stringify(digest),
      ``,
      ...retrievedEvidenceBlocks,
      ``,
      `CONVERSATION SO FAR:`,
      ...(history
        .slice(-6)
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`) || []),
      ``,
      `QUESTION: ${question}`,
    ];

    return {
      messages: [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(contextLines.join("\n")),
      ],
      stepCount: 0,
    };
  }

  // 2. Agent Node
  async function agentNode(state) {
    if (signal?.aborted)
      throw new AppError("JOB_CANCELLED", "The operation was cancelled.");

    const llm = getChatModel();
    const modelWithTools = llm.bindTools(toolDefs);
    const aiMessage = await modelWithTools.invoke(state.messages);

    return {
      messages: [aiMessage],
      stepCount: state.stepCount + 1,
    };
  }

  // 3. Tools Node (Custom Node)
  async function toolsNode(state) {
    if (signal?.aborted)
      throw new AppError("JOB_CANCELLED", "The operation was cancelled.");

    const lastMessage = state.messages[state.messages.length - 1];
    const toolCalls = lastMessage.tool_calls || [];
    const toolMessages = [];

    toolStepsCount++;

    for (const call of toolCalls) {
      if (totalToolExecutions >= MAX_TOTAL_TOOL_CALLS) {
        extraWarnings.push(
          "Tool execution limit reached; some calculations were omitted.",
        );
        toolMessages.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({
              error: { code: "TOOL_LIMIT", message: "Execution limit reached" },
            }),
          }),
        );
        continue;
      }

      totalToolExecutions++;

      if (!TOOL_NAMES.includes(call.name)) {
        toolTrace.push({
          tool: call.name,
          status: "error",
          argsSummary: JSON.stringify(call.args).slice(0, 300),
          evidenceId: null,
        });
        toolMessages.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({
              error: { code: "UNKNOWN_TOOL", message: "Tool not allowed" },
            }),
          }),
        );
        continue;
      }

      const toolSchema = TOOL_INPUT_SCHEMAS[call.name];
      const parsedArgs = toolSchema.safeParse(call.args);

      if (!parsedArgs.success) {
        toolTrace.push({
          tool: call.name,
          status: "error",
          argsSummary: JSON.stringify(call.args).slice(0, 300),
          evidenceId: null,
        });
        toolMessages.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({
              error: {
                code: "INVALID_ARGUMENTS",
                message: "Invalid arguments",
              },
            }),
          }),
        );
        continue;
      }

      const handler = toolHandlers[call.name];
      const toolCtx = { userId, sessionId, requestId, signal };

      try {
        const { output, evidence } = await handler(
          parsedArgs.data,
          bundle,
          toolCtx,
        );

        // Add to ledger
        const entry = ledger.add({
          artifactType: evidence.artifactType,
          artifactId: evidence.artifactId,
          skuId: evidence.skuId,
          source: "tool",
          toolName: call.name,
          payload: output,
          label: evidence.label,
        });

        toolTrace.push({
          tool: call.name,
          status: "ok",
          argsSummary: JSON.stringify(call.args).slice(0, 300),
          evidenceId: entry.evidenceId,
        });

        // Patch what-if run conversationId
        if (call.name === "run_what_if_scenario" && output.whatIfRunId) {
          await WhatIfRunModel.updateOne(
            { _id: output.whatIfRunId },
            { $set: { conversationId } },
          );
        }

        toolMessages.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({
              evidenceId: entry.evidenceId,
              result: output,
            }),
          }),
        );
      } catch (err) {
        console.warn("Tool execution error", {
          tool: call.name,
          err: err.message,
        });
        toolTrace.push({
          tool: call.name,
          status: "error",
          argsSummary: JSON.stringify(call.args).slice(0, 300),
          evidenceId: null,
        });
        toolMessages.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({
              error: {
                code: err.code || "INTERNAL_ERROR",
                message: err.message || "Tool execution failed",
              },
            }),
          }),
        );
      }
    }

    return {
      messages: toolMessages,
      stepCount: state.stepCount,
    };
  }

  // 4. Conditional Edge
  function shouldContinue(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      if (
        state.stepCount < MAX_TOOL_STEPS &&
        totalToolExecutions < MAX_TOTAL_TOOL_CALLS
      ) {
        return "tools";
      }
      extraWarnings.push(
        "Tool-call limit reached; the answer may be incomplete.",
      );
    }
    return "compose";
  }

  // 5. Compose Node
  let parsedDraft = null;
  let composeAttempts = 0;

  async function composeNode(state) {
    if (signal?.aborted)
      throw new AppError("JOB_CANCELLED", "The operation was cancelled.");

    const llm = getChatModel();
    const jsonSchemaStr = JSON.stringify(
      zodToJsonSchema(AssistantDraft, "AssistantDraft"),
      null,
      2,
    );

    const evidenceListLines = ledger.all().map((e) => {
      const firstKeys = (e.keys || []).slice(0, 25).join(", ");
      return `${e.evidenceId} | ${e.artifactType} | sku=${e.skuId || "none"} | ${e.label} | keys: ${firstKeys}`;
    });

    const composeMsg = new HumanMessage(
      COMPOSE_INSTRUCTION(jsonSchemaStr, evidenceListLines.join("\n")),
    );

    let messages = [...state.messages, composeMsg];

    for (let attempt = 1; attempt <= 3; attempt++) {
      composeAttempts = attempt;
      const res = await llm.invoke(messages);
      const rawText = res.content
        ? typeof res.content === "string"
          ? res.content
          : JSON.stringify(res.content)
        : "";

      // Strip code fences
      const cleanJson = rawText
        .replace(/```(?:json)?/gi, "")
        .replace(/```/g, "")
        .trim();

      try {
        const parsed = JSON.parse(cleanJson);
        const validated = AssistantDraft.safeParse(parsed);
        if (validated.success) {
          parsedDraft = validated.data;
          return { messages: [res] };
        } else {
          console.warn("Draft validation issues", {
            issues: validated.error.issues,
            attempt,
          });
          if (attempt < 3) {
            const issueSummary = validated.error.issues
              .slice(0, 10)
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("\n");
            messages.push(res);
            messages.push(
              new HumanMessage(
                `Your JSON response had validation errors:\n${issueSummary}\nReturn only the corrected JSON object.`,
              ),
            );
          }
        }
      } catch {
        console.warn("Draft JSON unparseable", { attempt });
        if (attempt < 3) {
          messages.push(res);
          messages.push(
            new HumanMessage(
              "Your response was not valid JSON. Return only the raw JSON object and nothing else.",
            ),
          );
        }
      }
    }

    throw new AppError(
      "AI_RESPONSE_INVALID",
      "The AI response could not be validated. Please rephrase and try again.",
    );
  }

  // 6. Verify Node
  let groundedResponse = null;
  async function verifyNode() {
    if (!parsedDraft) {
      throw new AppError(
        "INTERNAL_ERROR",
        "No parsed draft available for verification.",
      );
    }

    const grounded = groundDraft({
      draft: parsedDraft,
      ledger,
      sessionId,
      toolActions: toolTrace,
      extraWarnings,
      knownSkuIds,
    });

    try {
      groundedResponse = AssistantResponse.parse(grounded);
    } catch (valErr) {
      console.error("AssistantResponse schema validation failed", {
        err: valErr.message,
      });
      throw new AppError(
        "INTERNAL_ERROR",
        "Failed to validate grounded assistant response",
      );
    }

    return {};
  }

  // Build the StateGraph
  const workflow = new StateGraph(GraphAnnotation)
    .addNode("prepare", prepareNode)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addNode("compose", composeNode)
    .addNode("verify", verifyNode)
    .addEdge(START, "prepare")
    .addEdge("prepare", "agent")
    .addConditionalEdges("agent", shouldContinue, ["tools", "compose"])
    .addEdge("tools", "agent")
    .addEdge("compose", "verify")
    .addEdge("verify", END);

  const app = workflow.compile();

  // Run with 120s timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(
      () =>
        reject(new AppError("UPSTREAM_LLM_ERROR", "AI processing timed out")),
      120_000,
    );
  });

  try {
    await Promise.race([app.invoke({ messages: [] }), timeoutPromise]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err.message || "";
    if (
      err.status === 429 ||
      msg.includes("rate_limit") ||
      msg.includes("429") ||
      err.code === "rate_limit_exceeded"
    ) {
      throw new AppError(
        "RATE_LIMITED",
        "AI provider rate limit reached. Please wait a moment and try again.",
        { retryable: true, cause: err },
      );
    }
    throw new AppError("UPSTREAM_LLM_ERROR", msg || "AI provider error", {
      retryable: true,
      cause: err,
    });
  }

  const latencyMs = Date.now() - startTime;
  const env = (await import("../../config/env.js")).getEnv();

  return {
    response: groundedResponse,
    toolTrace,
    evidenceRefs: groundedResponse.evidence,
    modelMeta: {
      provider: env.LLM_PROVIDER || "unknown",
      model: env.LLM_MODEL || "unknown",
      latencyMs,
      attempts: composeAttempts,
    },
  };
}
