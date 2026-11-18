import { SESSION_TTL } from "../lib/constants.js";

export async function setCookie(res, key, value) {
  res.cookie(key, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL * 1000,
  });
}

export async function clearCookie(res, key) {
  res.clearCookie(key, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL * 1000,
  });
}
