class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Common HTTP Status Code Mappings
const ERROR_CODES = {
  BAD_REQUEST: { status: 400, code: 'BAD_REQUEST' },
  UNAUTHORIZED: { status: 401, code: 'UNAUTHORIZED' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN' },
  NOT_FOUND: { status: 404, code: 'NOT_FOUND' },
  CONFLICT: { status: 409, code: 'CONFLICT' },
  INTERNAL_SERVER_ERROR: { status: 500, code: 'INTERNAL_SERVER_ERROR' },
};

module.exports = {
  AppError,
  ERROR_CODES,
};
