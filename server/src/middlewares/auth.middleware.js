import { getAuth } from "firebase-admin/auth";
import { app } from "../config/firebase.js";
import { AppError } from "../utils/AppError.js";
import { getUserBySessionId } from "../repositories/session.repositories.js";
import * as userRepository from "../repositories/user.repositories.js";

export default async function authMiddleware(req, res, next) {
  try {
    // 1. Check Bearer token in Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token) {
        try {
          const decoded = await getAuth(app).verifyIdToken(token);
          let user = await userRepository.findOneUser({
            firebaseUid: decoded.uid,
          });
          if (!user) {
            user = await userRepository.createUser({
              firebaseUid: decoded.uid,
              name: decoded.name || decoded.email || "User",
              email: decoded.email,
              avatar: decoded.picture,
            });
          }
          req.user = user;
          return next();
        } catch (err) {
          throw new AppError(401, "Authentication failed: Invalid token");
        }
      }
    }

    // 2. Check Cookie session
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

