export class AtomicExecutor {
    queue = Promise.resolve();
    run(task) {
        const next = this.queue.then(task, task);
        this.queue = next.then(() => undefined, () => undefined);
        return next;
    }
}
