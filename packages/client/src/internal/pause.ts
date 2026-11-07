/**
 * The client's one abortable sleep: what a request handle's `wait()` pauses
 * with between status reads, shared with the framework's own poll loops.
 */

/**
 * Sleep `ms`, or reject with the signal's reason as soon as it aborts. The
 * abort listener is removed when the sleep ends, so a loop that pauses many
 * times on one signal holds at most one listener on it.
 */
export function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
