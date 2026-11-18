import redis from "../config/redis.js";
import { SESSION_TTL } from "../lib/constants.js";

export async function setSession(userId, sessionId, user) {
  await Promise.all([
    redis.set(
      `session-${sessionId}`,
      JSON.stringify({
        userId,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      }),
      {
        ex: SESSION_TTL,
      },
    ),
    redis.set(
      `user-session-${userId}`,
      JSON.stringify({
        sessionId: sessionId,
      }),
      {
        ex: SESSION_TTL,
      },
    ),
  ]);
}

export async function deleteSession(userId, sessionId) {
  await Promise.all([
    redis.del(`session-${sessionId}`),
    redis.del(`user-session-${userId}`),
  ]);
}

export async function getUserBySessionId(sessionId) {
  const rawUserData = await redis.get(`session-${sessionId}`);

  if (!rawUserData) return null;

  const user =
    typeof rawUserData === "string" ? JSON.parse(rawUserData) : rawUserData;

  return user || null;
}

export async function getSessionByUserId(userId) {
  const rawSessionData = await redis.get(`user-session-${userId}`);

  if (!rawSessionData) return null;

  const sessionData =
    typeof rawSessionData === "string"
      ? JSON.parse(rawSessionData)
      : rawSessionData;

  return sessionData?.sessionId || null;
}
