export class AppError extends Error {
  statusCode;
  isOperational;
  details = "";

  constructor(statusCode, message, details = "", isOperational = true) {
    super(message);

    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}
