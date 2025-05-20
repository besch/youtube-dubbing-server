export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const appErrors = {
  UNAUTHORIZED: new AppError("Unauthorized", "UNAUTHORIZED", 401),
  FORBIDDEN: new AppError("Forbidden", "FORBIDDEN", 403),
  NOT_FOUND: new AppError("Not found", "NOT_FOUND", 404),
  INVALID_INPUT: new AppError("Invalid input", "INVALID_INPUT", 400),
  STRIPE_ERROR: new AppError("Stripe error", "STRIPE_ERROR", 400),
  UNEXPECTED_ERROR: new AppError(
    "An unexpected error occurred",
    "UNEXPECTED_ERROR",
    500
  ),
} as const;
