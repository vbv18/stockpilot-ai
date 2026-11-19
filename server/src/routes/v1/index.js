import { Router } from "express";
import { SERVICE_NAME } from "../../config/constants.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import { attachUser } from "../../auth/currentUser.js";

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

// Authenticated router placeholder
const authenticatedRouter = Router();
router.use(authMiddleware);
router.use(attachUser());
router.use(authenticatedRouter);

export default router;
