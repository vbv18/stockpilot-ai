import { AppError } from "../utils/AppError.js";
import { getUserBySessionId } from "../repositories/session.repositories.js";

export default async function authMiddleware(req, res, next) {
  try {
    const sessionId = req.cookies?.session;

    if (!sessionId)
      throw new AppError(401, "Authentication required: Session not found");

    const user = await getUserBySessionId(sessionId);

    if (!user)
      throw new AppError(401, "Authentication expired: Please log in again");

    req.user = user;

    return next();
  } catch (error) {
    next(error);
  }
}
