/**
 * A worktree in use: the lock a run holds beside its working directory for as
 * long as it works there, and that `WorkspaceHost.remove` refuses to remove
 * under.
 *
 * Separate from the host's own place lock, which is held only while a place
 * is provisioned: a run's agent works long after that, and a removal that only
 * waited out provisioning would take the directory from under it. Every
 * caller that runs work in a host's worktree (a session's turn, a board run's
 * attempt) holds this one lock, at `<cwd>.lock`, so every removal sees it.
 */
import { acquireLock, HOST_LOCK_BOUNDS, type LockLease } from "./lock";

/** Where the in-use lock of the worktree at `cwd` lives: beside it, never inside. */
export function worktreeLockPath(cwd: string): string {
  return `${cwd}.lock`;
}

/**
 * Hold the worktree at `cwd` in use until the lease is released
 * (`releaseLock`). Waits while another holder has it. The lease refreshes
 * itself, so another run takes one left by a dead process a minute later;
 * `remove` never treats it as stale, so that file is deleted by hand.
 */
export async function occupyWorktree(cwd: string, options: { owner?: string; signal?: AbortSignal } = {}): Promise<LockLease> {
  return await acquireLock(worktreeLockPath(cwd), HOST_LOCK_BOUNDS, {
    ...(options.owner !== undefined ? { owner: options.owner } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    what: `the worktree at ${cwd}`,
  });
}
