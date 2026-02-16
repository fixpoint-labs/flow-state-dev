type WorkTaskRecord = {
  name: string;
  promise: Promise<unknown>;
};

export type WorkQueueResult = {
  completed: Array<{ name: string; value: unknown }>;
  failed: Array<{ name: string; error: Error }>;
};

export class WorkQueue {
  private readonly tasks: WorkTaskRecord[] = [];

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

  hasPendingWork(): boolean {
    return this.tasks.length > 0;
  }

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

export function createWorkQueue(): WorkQueue {
  return new WorkQueue();
}
