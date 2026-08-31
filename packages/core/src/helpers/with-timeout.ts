/**
 * Bound a promise with a deadline, without leaking the timer.
 *
 * The naive form of this — `Promise.race([promise, rejectAfter(ms)])` — leaves
 * a pending timer behind every time the bounded work wins the race. Harmless
 * once; on a hot path or a long-lived dispatcher the handles accumulate and
 * hold the event loop open past a shutdown that is otherwise finished. Every
 * settle path here clears the timer, which is why this is one helper rather
 * than an inline race per call site.
 */

/** Default rejection: `"<label> timed out after <ms>ms"`. */
function defaultTimeoutError(label: string, timeoutMs: number): Error {
  return new Error(`${label} timed out after ${timeoutMs}ms`);
}

/**
 * Resolve `promise`, or reject once `timeoutMs` elapses.
 *
 * The bounded work is **not** cancelled — nothing here can cancel a promise
 * somebody else handed us. What a timeout buys is that the *caller* stops
 * waiting. Pair it with an `AbortSignal` when the work itself is cancellable.
 *
 * @param promise    The work to bound.
 * @param timeoutMs  The deadline. `undefined` or `<= 0` means "no deadline" —
 *                   `promise` is returned untouched and no timer is created.
 * @param label      Names the bounded work in the rejection message.
 * @param onTimeout  Builds the rejection. Override it when a caller needs its
 *                   own error type — a timeout that must be classified rather
 *                   than just reported. Defaults to a plain `Error`.
 */
export function withTimeout<TValue>(
  promise: Promise<TValue>,
  timeoutMs: number | undefined,
  label: string,
  onTimeout: (label: string, timeoutMs: number) => Error = defaultTimeoutError
): Promise<TValue> {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return promise;
  }

  return new Promise<TValue>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(onTimeout(label, timeoutMs));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}
