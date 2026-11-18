import { Router } from "express";
import authMiddleware from "./middlewares/auth.middleware.js";
import errorMiddleware from "./middlewares/error.middleware.js";
import notFoundMiddleware from "./middlewares/notFound.middleware.js";
import asyncHandler from "./utils/asyncHandler.js";
import authRouter from "./routes/auth.route.js";
import userRouter from "./routes/user.route.js";

const app = Router();

app.use("/auth", asyncHandler(authRouter));
app.use(authMiddleware);
app.use("/user", asyncHandler(userRouter));

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
