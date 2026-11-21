import mongoose from "mongoose";
import AnalysisSessionModel from "../models/analysisSession.model.js";
import DatasetModel from "../models/dataset.model.js";
import ForecastRunModel from "../models/forecastRun.model.js";
import AssumptionSetModel from "../models/assumptionSet.model.js";
import OptimizationRunModel from "../models/optimizationRun.model.js";
import SimulationRunModel from "../models/simulationRun.model.js";
import WhatIfRunModel from "../models/whatIfRun.model.js";
import AiConversationModel from "../models/aiConversation.model.js";
import AiMessageModel from "../models/aiMessage.model.js";
import JobModel from "../models/job.model.js";

export async function connectDatabase() {
  try {
    const connectionString = process.env.MONGODB_URI || process.env.MONGO_URI;
    const dbName = process.env.MONGODB_DB_NAME;
    await mongoose.connect(connectionString, dbName ? { dbName } : undefined);
    console.log("Connected to MongoDB");

    // Sync indexes for all models
    await Promise.allSettled([
      AnalysisSessionModel.syncIndexes(),
      DatasetModel.syncIndexes(),
      ForecastRunModel.syncIndexes(),
      AssumptionSetModel.syncIndexes(),
      OptimizationRunModel.syncIndexes(),
      SimulationRunModel.syncIndexes(),
      WhatIfRunModel.syncIndexes(),
      AiConversationModel.syncIndexes(),
      AiMessageModel.syncIndexes(),
      JobModel.syncIndexes(),
    ]);
    console.log("MongoDB model indexes synchronized");
  } catch (error) {
    console.error("[DB] Error connecting to MongoDB", {
      status: error.response?.status,
      message: error.message,
      data: error.response?.data,
    });

    process.exit(1);
  }
}
