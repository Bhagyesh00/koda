export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super('not_found', `${what} not found`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('validation_error', message, 400);
  }
}

export class SandboxError extends AppError {
  constructor(message: string) {
    super('sandbox_violation', message, 403);
  }
}
