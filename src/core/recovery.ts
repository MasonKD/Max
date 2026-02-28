export type RecoveryHint = {
  action: string;
  detail?: string;
};

export class SelfMaxError extends Error {
  readonly kind: string;
  readonly recoveryHint?: RecoveryHint;

  constructor(kind: string, message: string, recoveryHint?: RecoveryHint) {
    super(message);
    this.name = kind;
    this.kind = kind;
    this.recoveryHint = recoveryHint;
  }
}

export class AuthError extends SelfMaxError {
  constructor(message: string, recoveryHint?: RecoveryHint) {
    super("AuthError", message, recoveryHint);
  }
}

export class SelectorError extends SelfMaxError {
  constructor(message: string, recoveryHint?: RecoveryHint) {
    super("SelectorError", message, recoveryHint);
  }
}

export class TimeoutError extends SelfMaxError {
  constructor(message: string, recoveryHint?: RecoveryHint) {
    super("TimeoutError", message, recoveryHint);
  }
}

export class StateError extends SelfMaxError {
  constructor(message: string, recoveryHint?: RecoveryHint) {
    super("StateError", message, recoveryHint);
  }
}

export function formatError(error: unknown): string {
  if (error instanceof SelfMaxError) {
    const hint = error.recoveryHint
      ? ` [hint: ${error.recoveryHint.action}${error.recoveryHint.detail ? ` - ${error.recoveryHint.detail}` : ""}]`
      : "";
    return `${error.kind}: ${error.message}${hint}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown error";
}
