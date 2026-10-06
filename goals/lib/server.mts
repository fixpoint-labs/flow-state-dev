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
