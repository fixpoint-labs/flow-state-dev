/**
 * TUI leave vs the host drain.
 *
 * `/quit` already stops every running request and restores the terminal. The
 * process then `dispose()`s the loaded `createFlowState`, which waits for
 * in-process detached children up to the coding-run budget — minutes, not a
 * keystroke. Grok leaves; the shell comes back. Waiting that budget after the
 * board is gone is the opposite.
 *
 * Abort still runs. This bound is only how long the renderer waits for unwind
 * before the process is allowed to exit. Headless verbs keep the full drain.
 */

/** Same ceiling the engine carves out for an aborted child's terminal write. */
export const TUI_LEAVE_DRAIN_MS = 2_000;

/**
 * Wait for `dispose` until `ms`, then return. The dispose continues; the
 * caller that wants the shell back must exit the process after this.
 *
 * `0` returns on the next turn without waiting — tests, and a host that
 * already finished abort.
 */
export async function boundedDispose(
  dispose: () => Promise<void>,
  ms: number,
): Promise<"settled" | "left"> {
  if (ms <= 0) {
    void dispose();
    return "left";
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const left = new Promise<"left">((resolve) => {
      timer = setTimeout(() => resolve("left"), ms);
    });
    const settled = dispose().then(() => "settled" as const);
    return await Promise.race([settled, left]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
