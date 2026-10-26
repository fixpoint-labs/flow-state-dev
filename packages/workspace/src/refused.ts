/**
 * The host's typed refusal, in a module of its own so both halves of the host
 * (`local-host` and the git half, `worktree`) can raise it without importing
 * each other.
 */

/**
 * The host would not provision this run, and says why — before any agent was
 * paid for. Nothing was created, and an existing checkout was left exactly as
 * it was.
 *
 * `reason` is stable: `"invalid-remote"`, `"remote-not-allowed"`,
 * `"remote-unreadable"`, `"base-diverged"` (a repository on this machine
 * whose base and its upstream each have commits the other lacks),
 * `"checkout-moved"` (the run's checkout is off the run's branch and is
 * mid-way through a merge, rebase or similar, or the run's branch is checked
 * out in another worktree), or
 * whatever reason a run source refused with. A caller should fail the run
 * with it rather than retry: none of these clears by itself, and the message
 * says what clears it. `base-diverged` clears once someone pulls or rebases,
 * or pushes, there; `checkout-moved` once someone does what its message names
 * in the checkout.
 */
export class WorkspaceRefusedError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceRefusedError";
  }
}
