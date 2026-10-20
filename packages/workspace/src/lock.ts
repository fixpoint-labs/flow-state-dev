/**
 * A lock on disk, so that two holders — in one process or in two — that share
 * a directory never work in one place at the same time.
 *
 * Two kinds of holder use it. A workspace host holds one while it provisions a
 * place or touches a clone, and REFRESHES it while it works (`heartbeatMs`): a
 * provision has no fixed deadline, so its lock is stale once its holder stopped
 * refreshing it, which is what a process that died does. A caller that holds a
 * lock for a run with a known deadline (harness-manager's checkout lease) does
 * not refresh it, and sizes `staleAfterMs` past the longest a live holder could
 * keep it.
 *
 * - **Acquiring is atomic**: an `O_EXCL` create either wins or does not.
 * - **Contention waits rather than fails**, up to `waitMs`. Two provisions of
 *   one place are ordinary, and failing one would spend a run's attempt on a
 *   lock.
 * - **A stale lock is taken only if it is still the one that was judged**
 *   (inode and bytes, re-read just before the unlink), and taking it only
 *   clears the path — the taker then competes for the `O_EXCL` create like
 *   any other waiter. Remove-then-create would let two waiters that judged one
 *   stale lock each remove the other's fresh one.
 * - **Release removes only this acquisition's lock**, by the token written in
 *   it, so a holder that overran and was displaced cannot free its
 *   replacement's lock. Compare-then-unlink is two syscalls, not one; a lock
 *   could change hands between them. That residual is narrow (a holder must
 *   release and another acquire between two adjacent syscalls) and is not
 *   closed here.
 * - **A permanent read failure is raised, not spun on.** Only a lock that
 *   vanished between the failed create and the read is retried at once.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GIT_TIMEOUT_MS } from "./exec";

/** How a lock is waited on and judged. */
export interface LockBounds {
  /** How long to wait for a live holder before failing. */
  waitMs: number;
  /** How often to re-check a held lock. */
  pollMs: number;
  /** A lock not refreshed for this long belongs to a holder that is gone. */
  staleAfterMs: number;
  /**
   * How often a holder refreshes its lock, well under `staleAfterMs`. Absent:
   * never, and `staleAfterMs` has to outlast the longest legitimate hold.
   */
  heartbeatMs?: number;
}

/** How one acquisition waits. All optional. */
export interface AcquireOptions {
  /** Who holds it, written into the lock file for a person reading it. */
  owner?: string;
  /** The clock. Injectable so a wait's arithmetic can be tested. */
  now?: () => number;
  /**
   * Stop waiting when this aborts. Checked before the first create and woken
   * by the sleep itself, so a cancelled waiter neither takes the lock nor
   * waits out a poll interval. Interrupting the wait is safe: nothing has
   * been made yet.
   */
  signal?: AbortSignal;
  /** What the lock guards, for the error a waiter gives up with. Defaults to the lock's path. */
  what?: string;
}

/**
 * The host's bounds. The wait outlasts a provision's git calls run back to
 * back, each at its own timeout, so a waiter fails only on a holder that is
 * wedged rather than slow.
 */
export const HOST_LOCK_BOUNDS: LockBounds = {
  waitMs: 8 * GIT_TIMEOUT_MS,
  pollMs: 50,
  staleAfterMs: 60_000,
  heartbeatMs: 10_000,
};

/**
 * A held lock. Hand it to `releaseLock` on every exit.
 *
 * `path` and `token` are plain values, so a holder can write them down (a
 * run's own state, say) and release from there; the token is what tells this
 * acquisition's lock from an identical-looking one a replacement made.
 */
export interface LockLease {
  /** The lock file. */
  path: string;
  /** Written into the lock file; unique to this acquisition. */
  token: string;
  /** Stops the refresh, when there is one. */
  timer?: ReturnType<typeof setInterval>;
}

/**
 * Wait `ms`, or until `signal` aborts, whichever is first. Resolves either
 * way; the caller checks the signal. An already-aborted signal returns at
 * once, since `abort` never replays for a listener armed after it fired.
 */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });

/** Wait for, and take, the lock at `path`. */
export async function acquireLock(
  path: string,
  bounds: LockBounds = HOST_LOCK_BOUNDS,
  options: AcquireOptions = {},
): Promise<LockLease> {
  const { now = Date.now, signal, owner } = options;
  const what = options.what ?? `the lock at ${path}`;
  const stopIfCancelled = (): void => {
    if (signal?.aborted !== true) return;
    throw new Error(
      `the wait for ${what} was cancelled before it took the lock. Stopping rather than ` +
        `taking a place whose work this caller can no longer use.`,
    );
  };
  stopIfCancelled();
  mkdirSync(dirname(path), { recursive: true });
  const deadline = now() + bounds.waitMs;

  for (;;) {
    const taken = attempt(path, bounds, owner, now);
    if (taken === "again") continue;
    if (taken !== "held") {
      if (bounds.heartbeatMs === undefined) return taken;
      const timer = setInterval(() => refresh(path, taken.token), bounds.heartbeatMs);
      timer.unref();
      return { ...taken, timer };
    }
    if (now() >= deadline) throw stillHeld(bounds, what, path);
    // Never past the deadline the caller was given.
    await sleep(Math.min(bounds.pollMs, deadline - now()), signal);
    stopIfCancelled();
  }
}

/**
 * Run `operation` holding the lock at `path`, for a caller that can't wait
 * asynchronously (a host's synchronous startup). The wait blocks the thread,
 * so it is only for a lock held for milliseconds; `bounds.heartbeatMs` is
 * ignored, and `staleAfterMs` has to outlast the longest hold. Released on
 * every exit.
 */
export function withLockSync<T>(path: string, bounds: LockBounds, operation: () => T, what = `the lock at ${path}`): T {
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + bounds.waitMs;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const taken = attempt(path, bounds, undefined, Date.now);
    if (taken === "again") continue;
    if (taken !== "held") {
      try {
        return operation();
      } finally {
        releaseLock(taken);
      }
    }
    if (Date.now() >= deadline) throw stillHeld(bounds, what, path);
    Atomics.wait(pause, 0, 0, Math.max(1, Math.min(bounds.pollMs, deadline - Date.now())));
  }
}

/**
 * One try at the lock: taken, `"again"` when a stale lock was cleared or the
 * holder released between the create and the read, or `"held"` by a live
 * holder.
 */
function attempt(path: string, bounds: LockBounds, owner: string | undefined, now: () => number): LockLease | "again" | "held" {
  const token = randomUUID();
  try {
    writeFileSync(path, JSON.stringify({ owner, token, pid: process.pid, at: now() }), { flag: "wx" });
    return { path, token };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  try {
    const victim = statSync(path);
    const held = readFileSync(path, "utf8");
    if (now() - victim.mtimeMs > bounds.staleAfterMs) {
      const current = statSync(path);
      if (current.ino === victim.ino && readFileSync(path, "utf8") === held) rmSync(path, { force: true });
      return "again";
    }
  } catch (error) {
    // Released between the failed create and the read: try again. Anything
    // else (a directory at the path, no permission) would fail the same way
    // on every pass, so it is raised rather than spun on.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return "again";
  }
  return "held";
}

/** The error a waiter gives up with. */
function stillHeld(bounds: LockBounds, what: string, path: string): Error {
  return new Error(
    `waited ${bounds.waitMs}ms for ${what} and it is still held. Treating that as a ` +
      `wedged holder rather than ordinary contention; if nothing holds it, remove ${path}.`,
  );
}

/** Release a lock this acquisition holds. Never removes another taker's. Idempotent. */
export function releaseLock(lease: LockLease): void {
  if (lease.timer !== undefined) clearInterval(lease.timer);
  if (holds(lease.path, lease.token)) rmSync(lease.path, { force: true });
}

/** Mark the lock live, if it is still this acquisition's. */
function refresh(path: string, token: string): void {
  if (!holds(path, token)) return;
  try {
    const now = new Date();
    utimesSync(path, now, now);
  } catch {
    // Gone between the read and the touch; nothing of ours to keep alive.
  }
}

function holds(path: string, token: string): boolean {
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { token?: unknown }).token === token;
  } catch {
    return false;
  }
}
