/**
 * Coalescing re-reads: one in flight, one queued. Internal: the task-board
 * panels' live driver re-reads a board through it on each change it hears.
 */
/**
 * Run `read` on request, one at a time. A request made while a read runs
 * queues exactly one more, however many arrive, which starts once that read
 * settles. `close` drops the queued one.
 */
export function coalescedReads(read: () => Promise<void>): { request: () => void; close: () => void } {
  let running = false;
  let queued = false;
  let closed = false;

  const run = (): void => {
    running = true;
    const settled = (): void => {
      running = false;
      if (closed || !queued) return;
      queued = false;
      run();
    };
    read().then(settled, settled);
  };

  return {
    request: () => {
      if (closed) return;
      if (running) queued = true;
      else run();
    },
    close: () => {
      closed = true;
      queued = false;
    }
  };
}
