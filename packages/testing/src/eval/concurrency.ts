type QueueEntry = {
  resolve: () => void;
};

export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createLimiter(concurrency: number): Limiter {
  let active = 0;
  const queue: QueueEntry[] = [];

  function next(): void {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const entry = queue.shift()!;
      entry.resolve();
    }
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active < concurrency) {
        active++;
      } else {
        await new Promise<void>((resolve) => {
          queue.push({ resolve });
        });
      }

      try {
        return await fn();
      } finally {
        active--;
        next();
      }
    },
  };
}
