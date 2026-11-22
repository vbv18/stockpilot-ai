import { AppError } from "../lib/errors.js";
import { AnalysisSessionModel } from "../models/analysisSession.model.js";
import { canTransition, ALLOWED_TRANSITIONS } from "./stateMachine.js";

function defaultSessionName() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  return `Analysis ${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function toSessionDto(doc) {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: d._id.toString(),
    name: d.name,
    status: d.status,
    stages: {
      dataset: {
        status: d.stages?.dataset?.status ?? "not_started",
        startedAt: d.stages?.dataset?.startedAt
          ? d.stages.dataset.startedAt.toISOString()
          : null,
        finishedAt: d.stages?.dataset?.finishedAt
          ? d.stages.dataset.finishedAt.toISOString()
          : null,
        errorCode: d.stages?.dataset?.errorCode ?? null,
        userMessage: d.stages?.dataset?.userMessage ?? null,
        retryable: d.stages?.dataset?.retryable ?? false,
        lastJobId: d.stages?.dataset?.lastJobId
          ? d.stages.dataset.lastJobId.toString()
          : null,
      },
      forecast: {
        status: d.stages?.forecast?.status ?? "not_started",
        startedAt: d.stages?.forecast?.startedAt
          ? d.stages.forecast.startedAt.toISOString()
          : null,
        finishedAt: d.stages?.forecast?.finishedAt
          ? d.stages.forecast.finishedAt.toISOString()
          : null,
        errorCode: d.stages?.forecast?.errorCode ?? null,
        userMessage: d.stages?.forecast?.userMessage ?? null,
        retryable: d.stages?.forecast?.retryable ?? false,
        lastJobId: d.stages?.forecast?.lastJobId
          ? d.stages.forecast.lastJobId.toString()
          : null,
      },
      optimization: {
        status: d.stages?.optimization?.status ?? "not_started",
        startedAt: d.stages?.optimization?.startedAt
          ? d.stages.optimization.startedAt.toISOString()
          : null,
        finishedAt: d.stages?.optimization?.finishedAt
          ? d.stages.optimization.finishedAt.toISOString()
          : null,
        errorCode: d.stages?.optimization?.errorCode ?? null,
        userMessage: d.stages?.optimization?.userMessage ?? null,
        retryable: d.stages?.optimization?.retryable ?? false,
        lastJobId: d.stages?.optimization?.lastJobId
          ? d.stages.optimization.lastJobId.toString()
          : null,
      },
      simulation: {
        status: d.stages?.simulation?.status ?? "not_started",
        startedAt: d.stages?.simulation?.startedAt
          ? d.stages.simulation.startedAt.toISOString()
          : null,
        finishedAt: d.stages?.simulation?.finishedAt
          ? d.stages.simulation.finishedAt.toISOString()
          : null,
        errorCode: d.stages?.simulation?.errorCode ?? null,
        userMessage: d.stages?.simulation?.userMessage ?? null,
        retryable: d.stages?.simulation?.retryable ?? false,
        lastJobId: d.stages?.simulation?.lastJobId
          ? d.stages.simulation.lastJobId.toString()
          : null,
      },
      portfolio: {
        status: d.stages?.portfolio?.status ?? "not_started",
        startedAt: d.stages?.portfolio?.startedAt
          ? d.stages.portfolio.startedAt.toISOString()
          : null,
        finishedAt: d.stages?.portfolio?.finishedAt
          ? d.stages.portfolio.finishedAt.toISOString()
          : null,
        errorCode: d.stages?.portfolio?.errorCode ?? null,
        userMessage: d.stages?.portfolio?.userMessage ?? null,
        retryable: d.stages?.portfolio?.retryable ?? false,
        lastJobId: d.stages?.portfolio?.lastJobId
          ? d.stages.portfolio.lastJobId.toString()
          : null,
      },
    },
    activeDatasetId: d.activeDatasetId ? d.activeDatasetId.toString() : null,
    activeForecastRunId: d.activeForecastRunId
      ? d.activeForecastRunId.toString()
      : null,
    activeAssumptionSetId: d.activeAssumptionSetId
      ? d.activeAssumptionSetId.toString()
      : null,
    activeOptimizationRunId: d.activeOptimizationRunId
      ? d.activeOptimizationRunId.toString()
      : null,
    activeSimulationRunId: d.activeSimulationRunId
      ? d.activeSimulationRunId.toString()
      : null,
    activePortfolioRunId: d.activePortfolioRunId
      ? d.activePortfolioRunId.toString()
      : null,
    budget: d.budget ?? null,
    capacity: d.capacity ?? null,
    aiIndex: {
      status: d.aiIndex?.status ?? "not_indexed",
      updatedAt: d.aiIndex?.updatedAt
        ? d.aiIndex.updatedAt.toISOString()
        : null,
    },
    archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
    completedAt: d.completedAt ? d.completedAt.toISOString() : null,
    createdAt: d.createdAt ? d.createdAt.toISOString() : null,
    updatedAt: d.updatedAt ? d.updatedAt.toISOString() : null,
  };
}

export function statesThatCanReach(targetState) {
  const fromStates = [];
  for (const [state, allowed] of Object.entries(ALLOWED_TRANSITIONS)) {
    if (allowed.includes(targetState)) {
      fromStates.push(state);
    }
  }
  return fromStates;
}

export async function createSession(userId, name) {
  const sessionName = name && name.trim() ? name.trim() : defaultSessionName();
  const session = await AnalysisSessionModel.create({
    userId,
    name: sessionName,
    status: "created",
  });
  return session;
}

export async function listSessions(
  userId,
  { page = 1, limit = 20, archived = false } = {},
) {
  const query = { userId };
  if (archived) {
    query.archivedAt = { $ne: null };
  } else {
    query.archivedAt = null;
  }

  const [items, total] = await Promise.all([
    AnalysisSessionModel.find(query)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    AnalysisSessionModel.countDocuments(query),
  ]);

  return { items, total };
}

export async function getSessionOwned(userId, sessionId) {
  const session = await AnalysisSessionModel.findOne({
    _id: sessionId,
    userId,
  });
  if (!session) {
    throw new AppError("NOT_FOUND", "Analysis session not found");
  }
  return session;
}

export function requireStatus(session, allowed) {
  if (!allowed.includes(session.status)) {
    throw new AppError(
      "INVALID_STATE",
      `This action is not available while the session is ${session.status}.`,
    );
  }
}

export async function transition(userId, sessionId, to, opts = {}) {
  const current = await getSessionOwned(userId, sessionId);
  if (!canTransition(current.status, to)) {
    throw new AppError(
      "INVALID_STATE",
      `Cannot transition session from ${current.status} to ${to}`,
    );
  }

  const allowedFrom = opts.from ?? statesThatCanReach(to);
  const updateSet = {
    status: to,
    ...(opts.set || {}),
  };
  if (to === "completed") {
    updateSet.completedAt = new Date();
  }

  const updated = await AnalysisSessionModel.findOneAndUpdate(
    {
      _id: sessionId,
      userId,
      status: { $in: allowedFrom },
    },
    { $set: updateSet },
    { new: true },
  );

  if (!updated) {
    throw new AppError(
      "INVALID_STATE",
      `Session status transition to ${to} failed due to state conflict.`,
    );
  }

  return updated;
}

export async function setStage(userId, sessionId, stage, patch) {
  const updateObj = {};
  for (const [key, val] of Object.entries(patch)) {
    updateObj[`stages.${stage}.${key}`] = val;
  }
  await AnalysisSessionModel.updateOne(
    { _id: sessionId, userId },
    { $set: updateObj },
  );
}
