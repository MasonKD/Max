export type SessionGateSnapshot = {
  ready: boolean;
  validatedAt?: string;
};

export class SessionGate {
  private ready = false;
  private validatedAt?: string;

  markReady(at = new Date().toISOString()): void {
    this.ready = true;
    this.validatedAt = at;
  }

  clear(): void {
    this.ready = false;
    this.validatedAt = undefined;
  }

  isReady(): boolean {
    return this.ready;
  }

  snapshot(): SessionGateSnapshot {
    return {
      ready: this.ready,
      validatedAt: this.validatedAt
    };
  }
}
