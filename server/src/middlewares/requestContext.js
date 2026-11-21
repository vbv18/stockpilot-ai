import crypto from "node:crypto";

const REQUEST_ID_REGEX = /^[A-Za-z0-9._-]{8,64}$/;

export function requestContext(req, res, next) {
  const incomingId = req.headers["x-request-id"];
  const requestId =
    typeof incomingId === "string" && REQUEST_ID_REGEX.test(incomingId)
      ? incomingId
      : crypto.randomUUID();

  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  next();
}
