/**
 * Starting and stopping a server a goal spawns for itself.
 *
 * A goal that spawns a server and then polls for readiness can be answered by
 * something else on the same port: a survivor from an earlier crashed run, or a
 * developer's own `fsdev dev`. The spawned child dies on EADDRINUSE, the
 * incumbent answers the readiness probe, and the goal grades code it did not
 * start. Two things close that:
 *
 *   - refuse to start when anything already answers on the port
 *     (`refuseIfAnswering`), and
 *   - spawn `detached` and stop the whole process group (`stopProcessGroup`),
 *     so a wrapper (`tsx`, `pnpm`) that is signalled does not leave its real
 *     server behind for the next run to grade.
 *
 * Pre-flight and readiness are OPPOSITE predicates and stay separate. This
 * module owns the first: ANY answer means stop. Readiness stays in the goal,
 * and wants a real 200 from the process it spawned — a shared "is it up?"
 * helper would reopen whichever half it did not serve.
 */
import type { ChildProcess } from "node:child_process";

/**
 * Throw when anything answers HTTP at `origin`, whatever the status.
 *
 * Call it before spawning. A 404 or a 500 counts: something is holding the
 * port, and the server this goal is about to start would fail to bind while
 * that process answered in its place.
 *
 * @param origin `http://127.0.0.1:<port>`, the address the goal will poll.
 * @throws If any HTTP response comes back.
 */
export async function refuseIfAnswering(origin: string): Promise<void> {
  let status: number | undefined;
  try {
    status = (await fetch(origin, { signal: AbortSignal.timeout(2_000) })).status;
  } catch {
    return;
  }
  throw new Error(
    `something is already answering on ${origin} (status ${status}); stop it first, or this check would ` +
      `grade it instead of the server it starts`,
  );
}

/**
 * Send `signal` to the process group of a child spawned with `detached: true`.
 *
 * Signalling only the child reaches the wrapper and can leave the server it
 * started still listening. A child that is already gone is not an error.
 */
export function stopProcessGroup(child: ChildProcess | undefined, signal: NodeJS.Signals = "SIGTERM"): void {
  if (child?.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}

/** How long {@link onClosed} waits for the pipes to drain once the child itself has exited. */
const CLOSE_GRACE_MS = 2_000;

/**
 * Call `done` once `child` has exited and its output has been read to the end.
 *
 * That is `close`, not `exit`: at `exit` the last chunks of stdout can still be
 * unread. But `close` also waits for every process holding the pipe, and a
 * grandchild that inherited it (the process `tsx` or `pnpm` starts, esbuild's
 * service, a server's own children) can outlive the child. So `done` also fires
 * {@link CLOSE_GRACE_MS} after `exit`, and then the child's pipes are released,
 * so a leaked grandchild delays a stop by that much at most and never hangs it.
 */
export function onClosed(child: ChildProcess, done: (code: number | null, signal: NodeJS.Signals | null) => void): void {
  let timer: NodeJS.Timeout | undefined;
  let called = false;
  const finish = (code: number | null, signal: NodeJS.Signals | null) => {
    if (called) return;
    called = true;
    clearTimeout(timer);
    done(code, signal);
  };
  child.once("close", finish);
  child.once("exit", (code, signal) => {
    timer = setTimeout(() => {
      for (const stream of [child.stdout, child.stderr]) stream?.destroy();
      finish(code, signal);
    }, CLOSE_GRACE_MS);
  });
}
