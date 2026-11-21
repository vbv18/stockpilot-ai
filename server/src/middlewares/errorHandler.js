import { ZodError } from "zod";
import { AppError, zodDetails } from "../lib/errors.js";

export function errorHandler(err, req, res, next) {
  const requestId =
    res.locals.requestId || req.headers["x-request-id"] || "unknown";

  if (err instanceof AppError) {
    return res.status(err.httpStatus).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
        requestId,
      },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation error",
        details: zodDetails(err),
        requestId,
      },
    });
  }

  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: {
        code: "FILE_TOO_LARGE",
        message: "Uploaded file exceeds maximum allowed size",
        requestId,
      },
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Malformed JSON body",
        requestId,
      },
    });
  }

  // Check if it's the old AppError from utils/AppError.js
  if (err && typeof err.statusCode === "number" && !err.httpStatus) {
    return res.status(err.statusCode).json({
      error: {
        code:
          err.statusCode === 401
            ? "UNAUTHENTICATED"
            : err.statusCode === 404
              ? "NOT_FOUND"
              : "INTERNAL_ERROR",
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        requestId,
      },
    });
  }

  // Unknown / unhandled errors
  console.error("Unhandled internal error", { err, requestId });

  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
      requestId,
    },
  });
}

export function notFoundHandler(req, res) {
  const requestId =
    res.locals.requestId || req.headers["x-request-id"] || "unknown";
  return res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
      requestId,
    },
  });
}
