import { Router } from "express";
import { SERVICE_NAME } from "../../config/constants.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import { attachUser } from "../../auth/currentUser.js";
import {
  aiLimiter,
  generalLimiter,
  uploadLimiter,
} from "../../middlewares/rateLimit.js";

// Import stage job handlers to register them
import "../../services/datasetHandlers.js";
import "../../services/forecastHandlers.js";
import "../../services/optimizationHandlers.js";
import "../../services/simulationHandlers.js";

// Import route modules
import sessionsRouter from "./sessions.js";
import jobsRouter from "./jobs.js";
import datasetsRouter from "./datasets.js";
import forecastRouter from "./forecast.js";
import assumptionsRouter from "./assumptions.js";
import optimizationRouter from "./optimization.js";
import simulationsRouter from "./simulations.js";
import aiRouter from "./ai.js";

const router = Router();

// Public health check endpoint
router.get("/health", (req, res) => {
  return res.status(200).json({
    data: {
      status: "ok",
      service: SERVICE_NAME,
      time: new Date().toISOString(),
    },
  });
});

// Authenticated router
const authenticatedRouter = Router();
authenticatedRouter.use(authMiddleware);
authenticatedRouter.use(attachUser());
authenticatedRouter.use(generalLimiter);

// Mount session routes
authenticatedRouter.use("/sessions", sessionsRouter);
authenticatedRouter.use("/sessions/:sessionId/jobs", jobsRouter);
authenticatedRouter.use(
  "/sessions/:sessionId/dataset",
  uploadLimiter,
  datasetsRouter,
);
authenticatedRouter.use("/sessions/:sessionId/forecast", forecastRouter);
authenticatedRouter.use("/sessions/:sessionId/assumptions", assumptionsRouter);
authenticatedRouter.use(
  "/sessions/:sessionId/optimization",
  optimizationRouter,
);
authenticatedRouter.use("/sessions/:sessionId/optimize", optimizationRouter);
authenticatedRouter.use("/sessions/:sessionId/simulations", simulationsRouter);
authenticatedRouter.use("/ai", aiLimiter, aiRouter);

router.use(authenticatedRouter);

export default router;
