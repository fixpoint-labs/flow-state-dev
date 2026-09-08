/**
 * `@flow-state-dev/harness-manager/checkout` — how a run gets a directory.
 *
 * **A separate entry point because these are not the supported contract.**
 * `harnessManager({ harness })` plus the construction guards is what this
 * package promises and versions. Everything here is git-worktree-specific:
 * `provisionCheckout` cuts a worktree, `acquireCheckout` takes a lock file
 * beside the tree, and the path grammar assumes both. A second checkout
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

export {
  run,
  CHECKOUT_CLEANUP_TIMEOUT_MS,
  GIT_TIMEOUT_MS,
  NETWORK_CALL_TIMEOUT_MS,
  type RunOptions,
} from "./exec";
