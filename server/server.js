import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { getEnv } from "./src/config/env.js";
import { logger } from "./src/lib/logger.js";
import { requestContext } from "./src/middlewares/requestContext.js";
import { connectDatabase } from "./src/config/db.js";
import { errorHandler, notFoundHandler } from "./src/middlewares/errorHandler.js";
import { recoverInterruptedJobs } from "./src/services/jobRunner.js";
import v1Router from "./src/routes/v1/index.js";
import legacyApp from "./src/app.js";

// (a) call getEnv() first (fail fast)
const env = getEnv();

const server = express();

// (b) requestContext as the first middleware
server.use(requestContext);

// (c) helmet()
server.use(helmet());

// (d) CORS allowlist from CORS_ORIGINS
const allowedOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
server.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (like mobile apps or curl)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS policy violation"), false);
    },
    credentials: true,
  }),
);

// (e) body parser express.json({ limit: "1mb" })
server.use(express.json({ limit: "1mb" }));
server.use(cookieParser());

// (f) mount v1Router at /api/v1 (health check and new v1 routes)
server.use("/api/v1", v1Router);

// Mount existing legacy routes under /api/v1 for backward compatibility
server.use("/api/v1", legacyApp);

// (g) at the end add notFoundHandler then errorHandler
server.use(notFoundHandler);
server.use(errorHandler);

const port = env.PORT;

server.listen(port, async () => {
  await connectDatabase();
  await recoverInterruptedJobs();
  logger.info(`Backend Service is running on port ${port}`);
});

export default server;
