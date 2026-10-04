/**
 * A lock on disk, so that two hosts — in one process or in two — that share a
 * root never provision one place or one clone at the same time.
 *
 * Ported from harness-manager's checkout lease (`acquireCheckout` /
 * `releaseCheckout`), with one change: the holder REFRESHES the lock while it
 * works. Harness-manager can size its stale bound past a run's whole deadline;
 * a host's provision has no such deadline (it spans several git calls, each
 * bounded on its own, and a hydrate), so instead a lock is stale once its
 * holder stopped refreshing it — which is what a process that died does.
 *
 * - **Acquiring is atomic**: an `O_EXCL` create either wins or does not.
 * - **Contention waits rather than fails**, up to `waitMs`. Two provisions of
 *   one place are ordinary, and failing one would spend a run's attempt on a
 *   lock.
 * - **A stale lock is taken only if it is still the one that was judged**
 *   (inode and bytes, re-read just before the unlink), and taking it only
 *   clears the path — the taker then competes for the `O_EXCL` create like
 *   any other waiter.
 * - **Release removes only this acquisition's lock**, by the token written in
 *   it. Compare-then-unlink is two syscalls, not one; the window between them
 *   is the residual harness-manager documents, unchanged here.
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
  /** How often a holder refreshes its lock. Well under `staleAfterMs`. */
  heartbeatMs: number;
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

/** A held lock. Hand it to `releaseLock` on every exit. */
export interface LockLease {
  /** The lock file. */
  path: string;
  /** Written into the lock file; unique to this acquisition. */
  token: string;
  /** Stops the refresh. */
  timer: ReturnType<typeof setInterval>;
}

/** Wait for, and take, the lock at `path`. */
export async function acquireLock(path: string, bounds: LockBounds = HOST_LOCK_BOUNDS): Promise<LockLease> {
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + bounds.waitMs;

  for (;;) {
    const token = randomUUID();
    try {
      writeFileSync(path, JSON.stringify({ token, pid: process.pid, at: Date.now() }), { flag: "wx" });
      const timer = setInterval(() => refresh(path, token), bounds.heartbeatMs);
      timer.unref();
      return { path, token, timer };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    try {
      const victim = statSync(path);
      const held = readFileSync(path, "utf8");
      if (Date.now() - victim.mtimeMs > bounds.staleAfterMs) {
        const current = statSync(path);
        if (current.ino === victim.ino && readFileSync(path, "utf8") === held) rmSync(path, { force: true });
        continue;
      }
    } catch (error) {
      // Released between the failed create and the read: try again. Anything
      // else (a directory at the path, no permission) would fail the same way
      // on every pass, so it is raised rather than spun on.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      continue;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `waited ${bounds.waitMs}ms for the lock at ${path} and it is still held, and still ` +
          `refreshed by its holder. Treating that as a wedged provision rather than ordinary ` +
          `contention; if no provision is running, remove the file.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(bounds.pollMs, deadline - Date.now())));
  }
}

/** Release a lock this acquisition holds. Never removes another taker's. Idempotent. */
export function releaseLock(lease: LockLease): void {
  clearInterval(lease.timer);
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
