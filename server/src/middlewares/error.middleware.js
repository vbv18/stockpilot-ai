import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";

export default function errorMiddleware(err, req, res, next) {
  // Already-classified operational errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      details: err.details,
    });
  }

  // Mongoose duplicate key
  // Occurs as a race condition even if you check for existence beforehand.
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "Resource already exists.",
    });
  }

  // Mongoose: schema validation error
  if (err instanceof mongoose.Error.ValidationError) {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      message: messages.join(", "),
    });
  }

  // Mongoose: invalid ObjectId / type cast failure
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      success: false,
      message: `Invalid value for field: ${err.path}`,
    });
  }

  // JWT errors - thrown by jwt.verify()
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Token expired.",
    });
  }

  // Log unknown errors — don't expose internals
  console.error(err);

  return res.status(500).json({
    success: false,
    message: "Internal server error.",
  });
}
