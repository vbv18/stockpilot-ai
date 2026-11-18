import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import morgan from "morgan";
import app from "./src/app.js";
import { connectDatabase } from "./src/config/db.js";
import { ENV } from "./src/config/config.js";

const server = express();

server.use(
  cors({
    origin: ENV.ALLOWED_ORIGIN,
    credentials: true,
  }),
);
server.use(cookieParser());
server.use(express.json());
server.use(morgan("dev"));

server.use("/api/v1", app);

const port = ENV.PORT;

server.listen(port, async () => {
  await connectDatabase();
  console.log(`Backend Service is running on ${port} Port`);
});
