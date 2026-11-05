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
 *
 * Also what a caller sharing a worktree reads of it: the branch checked out
 * there (`checkedOutBranch`), so a session attached to another's worktree can
 * tell whether its turn left the owner's branch where it found it.
 */
import { GIT_TIMEOUT_MS, run } from "./exec";
import { acquireLock, HOST_LOCK_BOUNDS, type LockLease } from "./lock";

/** The branch checked out in the worktree at `cwd`, or `null` when HEAD is detached or git can't say. */
export async function checkedOutBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd, timeoutMs: GIT_TIMEOUT_MS });
    return stdout.trim() === "" ? null : stdout.trim();
  } catch {
    return null;
  }
}

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
