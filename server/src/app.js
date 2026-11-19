import { Router } from "express";
import authMiddleware from "./middlewares/auth.middleware.js";
import asyncHandler from "./utils/asyncHandler.js";
import authRouter from "./routes/auth.route.js";
import userRouter from "./routes/user.route.js";

const app = Router();

app.use("/auth", authRouter);
app.use("/user", authMiddleware, userRouter);

export default app;
