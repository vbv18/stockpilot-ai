import { Router } from "express";
import * as controller from "../controllers/auth.controller.js";

const authRouter = Router();

authRouter.post("/login", controller.login);
authRouter.post("/logout", controller.logout);

export default authRouter;
