import { AppError } from "../../lib/errors.js";
import { AnalysisSessionModel } from "../../models/analysisSession.model.js";
import { DatasetModel } from "../../models/dataset.model.js";
import { ForecastRunModel } from "../../models/forecastRun.model.js";
import { AssumptionSetModel } from "../../models/assumptionSet.model.js";
import { OptimizationRunModel } from "../../models/optimizationRun.model.js";
import { SimulationRunModel } from "../../models/simulationRun.model.js";
import { PortfolioRunModel } from "../../models/portfolioRun.model.js";
import { ReplayRunModel } from "../../models/replayRun.model.js";
import { loadProcessedSeries } from "../processedSeries.js";

/**
 * Loads the canonical session bundle checking ownership. Throws 404 on miss.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @returns {Promise<{
 *   session: any,
 *   dataset: any | null,
 *   forecastRun: any | null,
 *   assumptions: any | null,
 *   optimizationRun: any | null,
 *   simulationRun: any | null,
 *   portfolioRun: any | null,
 *   replayRun: any | null,
 *   history: any[] | null
 * }>}
 */
export async function loadSessionBundle(userId, sessionId) {
  const session = await AnalysisSessionModel.findOne({
    _id: sessionId,
    userId,
  });
  if (!session) {
    throw new AppError("NOT_FOUND", "Session not found");
  }

  // Active dataset
  const dataset = session.activeDatasetId
    ? await DatasetModel.findOne({ _id: session.activeDatasetId, userId })
    : null;

  // Active succeeded forecast run
  const forecastRun = session.activeForecastRunId
    ? await ForecastRunModel.findOne({
        _id: session.activeForecastRunId,
        userId,
        status: "succeeded",
      })
    : null;

  // Active succeeded optimization run
  const optimizationRun = session.activeOptimizationRunId
    ? await OptimizationRunModel.findOne({
        _id: session.activeOptimizationRunId,
        userId,
        status: "succeeded",
      })
    : null;

  // Assumptions referenced by optimization run, else session's active set
  const assumptionSetId =
    optimizationRun?.assumptionSetId || session.activeAssumptionSetId;
  const assumptions = assumptionSetId
    ? await AssumptionSetModel.findOne({ _id: assumptionSetId, userId })
    : null;

  // Active succeeded simulation run
  const simulationRun = session.activeSimulationRunId
    ? await SimulationRunModel.findOne({
        _id: session.activeSimulationRunId,
        userId,
        status: "succeeded",
      })
    : null;

  // Active succeeded portfolio run
  const portfolioRun = session.activePortfolioRunId
    ? await PortfolioRunModel.findOne({
        _id: session.activePortfolioRunId,
        userId,
        status: "succeeded",
      })
    : null;

  // Active succeeded replay run
  const replayRun = session.activeReplayRunId
    ? await ReplayRunModel.findOne({
        _id: session.activeReplayRunId,
        userId,
        status: "succeeded",
      })
    : null;

  // Load processed series history if dataset status is ready
  let history = null;
  if (dataset && dataset.status === "ready") {
    try {
      history = await loadProcessedSeries(userId, dataset._id.toString());
    } catch {
      history = null;
    }
  }

  return {
    session,
    dataset,
    forecastRun,
    assumptions,
    optimizationRun,
    simulationRun,
    portfolioRun,
    replayRun,
    history,
  };
}
