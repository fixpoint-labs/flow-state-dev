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
 * A goal that proves work survives the host dying crashes it with
 * `crashAndRestart`: SIGKILL to the whole group, checked gone, then served
 * again by the goal's own start, on the store that start keeps.
 *
 * Pre-flight and readiness are OPPOSITE predicates and stay separate. This
 * module owns the first: ANY answer means stop. Readiness stays in the goal,
 * and wants a real 200 from the process it spawned — a shared "is it up?"
 * helper would reopen whichever half it did not serve.
 */
import type { ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";

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

/** How long {@link crashAndRestart} waits for the killed group to be gone, and how often it looks. */
const CRASH_GONE_MS = 10_000;
const CRASH_POLL_MS = 100;

/**
 * The members of process group `pgid` that are still running.
 *
 * A killed process stays in its group as a zombie until its parent reaps it,
 * and an orphan's new parent (a container's PID 1) may never do so. Where
 * `/proc` exists, zombies are left out; elsewhere the group counts as running
 * while the kernel still delivers to it.
 */
function liveMembers(pgid: number): number[] {
  if (!existsSync("/proc/self/stat")) {
    try {
      process.kill(-pgid, 0);
      return [pgid];
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM" ? [pgid] : [];
    }
  }
  const live: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    let stat: string;
    try {
      stat = readFileSync(`/proc/${entry}/stat`, "utf8");
    } catch {
      continue; // exited while we looked
    }
    // pid (comm) state ppid pgrp …; comm may hold spaces and parentheses.
    const [state, , pgrp] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(pgrp) === pgid && state !== "Z") live.push(Number(entry));
  }
  return live;
}

/**
 * Crash a host the way a power cut or an OOM does, then serve it again.
 *
 * Sends SIGKILL to the process group of `child`, so nothing in it gets to run
 * a shutdown, waits until no member of the group is left, and then calls
 * `start`. The wait is what keeps the new host from sharing the store with a
 * survivor. `start` is the goal's own, and keeps the store: this never learns
 * where an app keeps it.
 *
 *   served = await crashAndRestart(served.child, () => serveLab(serving, "after"));
 *
 * @param child The running host, spawned with `detached: true`.
 * @param start Serves the app again, on the same store.
 * @returns What `start` returns.
 * @throws When `child` leads no process group of its own (it was not spawned
 *   `detached`, or is already gone), or when a member of the group is still
 *   running {@link CRASH_GONE_MS} after the kill. The survivors are then
 *   killed too, so a failed crash leaves nothing behind.
 */
export async function crashAndRestart<T>(child: ChildProcess, start: () => Promise<T>): Promise<T> {
  const pgid = child.pid;
  if (pgid === undefined || liveMembers(pgid).length === 0) {
    throw new Error(`crashAndRestart: process ${pgid ?? "(never started)"} leads no process group; spawn it with detached: true`);
  }
  stopProcessGroup(child, "SIGKILL"); // the crash
  let survivors = liveMembers(pgid);
  for (const until = Date.now() + CRASH_GONE_MS; survivors.length > 0 && Date.now() < until; survivors = liveMembers(pgid)) {
    await new Promise<void>((resolve) => setTimeout(resolve, CRASH_POLL_MS));
  }
  if (survivors.length > 0) {
    for (const pid of survivors) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    throw new Error(
      `crashAndRestart: the process group survived: ${survivors.join(", ")} still running ${CRASH_GONE_MS / 1000}s after SIGKILL to group ${pgid}`,
    );
  }
  return start();
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
    if (called) return;
    timer = setTimeout(() => {
      for (const stream of [child.stdout, child.stderr]) stream?.destroy();
      finish(code, signal);
    }, CLOSE_GRACE_MS);
  });
}
