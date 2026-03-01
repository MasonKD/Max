export type RecoveryHint = {
  action: string;
  detail?: string;
};

export type ErrorContext = {
  url?: string;
  target?: string;
  expected?: string;
  observed?: string;
};

export class SelfMaxError extends Error {
  readonly kind: string;
  readonly recoveryHint?: RecoveryHint;
  readonly context?: ErrorContext;

  constructor(kind: string, message: string, recoveryHint?: RecoveryHint, context?: ErrorContext) {
    super(message);
    this.name = kind;
    this.kind = kind;
    this.recoveryHint = recoveryHint;
    this.context = context;
  }
}

export class AuthError extends SelfMaxError {
  constructor(message: string, recoveryHint?: RecoveryHint, context?: ErrorContext) {
    super("AuthError", message, recoveryHint, context);
  }
}

export class SelectorError extends SelfMaxError {
  constructor(message: string, recoveryHint?: RecoveryHint, context?: ErrorContext) {
    super("SelectorError", message, recoveryHint, context);
  }
}

export class TimeoutError extends SelfMaxError {
  constructor(message: string, recoveryHint?: RecoveryHint, context?: ErrorContext) {
    super("TimeoutError", message, recoveryHint, context);
  }
}

export class StateError extends SelfMaxError {
  constructor(message: string, recoveryHint?: RecoveryHint, context?: ErrorContext) {
    super("StateError", message, recoveryHint, context);
  }
}

export function formatError(error: unknown): string {
  if (error instanceof SelfMaxError) {
    const hint = error.recoveryHint
      ? ` [hint: ${error.recoveryHint.action}${error.recoveryHint.detail ? ` - ${error.recoveryHint.detail}` : ""}]`
      : "";
    const context = error.context
      ? ` [context: ${Object.entries(error.context)
          .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
          .map(([key, value]) => `${key}=${value}`)
          .join(" ")}]`
      : "";
    return `${error.kind}: ${error.message}${hint}${context}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown error";
}
