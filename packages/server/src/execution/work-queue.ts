/**
 * Runtime queue for background work tasks that may outlive main block execution.
 */
type WorkTaskRecord = {
  name: string;
  promise: Promise<unknown>;
};

export type WorkQueueResult = {
  completed: Array<{ name: string; value: unknown }>;
  failed: Array<{ name: string; error: Error }>;
};

/**
 * Collects asynchronous work and resolves all queued tasks in batch.
 */
export class WorkQueue {
  private readonly tasks: WorkTaskRecord[] = [];

  /**
   * Adds a unit of background work to the queue.
   */
  addWork(
    task: () => Promise<unknown> | unknown,
    options: { name?: string } = {}
  ): void {
    const name = options.name ?? `work_${this.tasks.length + 1}`;
    const promise = Promise.resolve().then(task);
    this.tasks.push({
      name,
      promise
    });
  }

  /**
   * Returns whether the queue currently has pending tasks.
   */
  hasPendingWork(): boolean {
    return this.tasks.length > 0;
  }

  /**
   * Awaits all currently queued work and returns settled results.
   */
  async waitForWork(options: {
    failOnError?: boolean;
  } = {}): Promise<WorkQueueResult> {
    const currentTasks = [...this.tasks];
    this.tasks.length = 0;

    const settled = await Promise.all(
      currentTasks.map(async (task) => {
        try {
          const value = await task.promise;
          return {
            status: "fulfilled" as const,
            name: task.name,
            value
          };
        } catch (error) {
          return {
            status: "rejected" as const,
            name: task.name,
            error:
              error instanceof Error
                ? error
                : new Error("Unknown work task failure")
          };
        }
      })
    );

    const result: WorkQueueResult = {
      completed: settled
        .filter((entry) => entry.status === "fulfilled")
        .map((entry) => ({
          name: entry.name,
          value: entry.value
        })),
      failed: settled
        .filter((entry) => entry.status === "rejected")
        .map((entry) => ({
          name: entry.name,
          error: entry.error
        }))
    };

    if (options.failOnError === true && result.failed.length > 0) {
      throw result.failed[0]!.error;
    }

    return result;
  }
}

/**
 * Creates a new empty work queue.
 */
export function createWorkQueue(): WorkQueue {
  return new WorkQueue();
}
