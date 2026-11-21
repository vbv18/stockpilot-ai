import { ZodError } from "zod";
import { HTTP_STATUS_BY_CODE } from "../contracts/common.js";

export class AppError extends Error {
  constructor(code, message, opts = {}) {
    super(
      message,
      opts.cause !== undefined ? { cause: opts.cause } : undefined,
    );
    this.name = "AppError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code] || 500;
    this.statusCode = this.httpStatus;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
  }
}

export function zodDetails(err) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
}

export const notFound = (what = "Resource") =>
  new AppError("NOT_FOUND", `${what} not found`);
