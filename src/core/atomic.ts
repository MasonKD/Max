export class AtomicExecutor {
  private queue: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
