/**
 * `@flow-state-dev/harness-manager/checkout` — how a run gets a directory.
 *
 * **A separate entry point because these are not the supported contract.**
 * `harnessManager({ harness })` plus the construction guards is what this
 * package promises and versions. Everything here is git-worktree-specific:
 * `provisionCheckout` cuts a worktree (through `@flow-state-dev/workspace`'s
 * host, which runs the git), `acquireCheckout` takes a lock file beside the
 * tree, and the path grammar assumes both. A second checkout
 * strategy — a fresh clone per run, a projected workspace — would put them
 * behind a seam, and a host that built on them would move with it.
 *
 * It is a subpath rather than a comment on the main barrel because semver binds
 * what `index.ts` exports regardless of what a file header says. Splitting the
 * entry point is what makes the two halves actually different.
 *
 * The consumer in this repository and its goal checks import from here. If you
 * are a host, you probably want the main entry.
 */
export {
  acquireCheckout,
  branchFor,
  canonicalSegment,
  checkoutPathFor,
  encodeSegment,
  harnessTaskId,
  isStrictlyInside,
  joinIdentity,
  provisionCheckout,
  releaseCheckout,
  sameSegment,
  assertSafeSegment,
  tenantSegment,
  type CheckoutLease,
  type RunLocation,
  type RunPrincipal,
} from "./workspace";

// The one way this package's callers start a child process, and the git
// budgets, are `@flow-state-dev/workspace`'s: harness-manager runs no git of
// its own. Re-exported so existing imports keep working.
export {
  run,
  CHECKOUT_CLEANUP_TIMEOUT_MS,
  GIT_TIMEOUT_MS,
  type RunOptions,
} from "@flow-state-dev/workspace";
export { NETWORK_CALL_TIMEOUT_MS } from "./timeouts";
