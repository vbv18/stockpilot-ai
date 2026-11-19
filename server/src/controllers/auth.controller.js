import { getAuth } from "firebase-admin/auth";
import { app } from "../config/firebase.js";
import * as userRepository from "../repositories/user.repositories.js";
import * as sessionRepository from "../repositories/session.repositories.js";
import { setCookie, clearCookie } from "../utils/cookies.js";

export async function login(req, res, next) {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Firebase token is required",
        },
      });
    }

    let decoded;
    try {
      decoded = await getAuth(app).verifyIdToken(token);
    } catch (authErr) {
      return res.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Invalid or expired Firebase token: " + authErr.message,
        },
      });
    }

    let user = await userRepository.findOneUser({
      firebaseUid: decoded.uid,
      email: decoded.email,
    });

    if (!user) {
      user = await userRepository.createUser({
        firebaseUid: decoded.uid,
        name: decoded.name || decoded.email || "User",
        email: decoded.email,
        avatar: decoded.picture,
      });
    } else {
      let updated = false;
      if (!user.firebaseUid && decoded.uid) {
        user.firebaseUid = decoded.uid;
        updated = true;
      }
      if (decoded.picture && user.avatar !== decoded.picture) {
        user.avatar = decoded.picture;
        updated = true;
      }
      if (updated) {
        await user.save();
      }
    }

    const sessionId = crypto.randomUUID();

    await sessionRepository.setSession(user._id, sessionId, user);

    setCookie(res, "session", sessionId);

    return res.status(200).json({
      message: "Logged In Successfuly",
      user,
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res) {
  const sessionId = req.cookies?.session;

  if (sessionId) {
    const user = await sessionRepository.getUserBySessionId(sessionId);

    if (user?.userId) {
      await sessionRepository.deleteSession(user.userId, sessionId);
    }
  }

  clearCookie(res, "session");

  return res.status(200).json({
    message: "Logged Out Successfully",
  });
}
