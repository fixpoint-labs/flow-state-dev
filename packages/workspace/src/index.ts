/**
 * `@flow-state-dev/workspace` — the file projection, and the workspace host
 * built on it.
 *
 * One piece of machinery moving file content between resource collections and
 * wherever an agent works, so the shell path and the coding path share a
 * behaviour instead of drifting apart with a copy each. The host
 * (`./local-host`) turns a run source's answer (`./run-source`) into that
 * place: a branch of a repository, or a set of kept files. Every git process
 * the package starts goes through `./exec`, and the git that cuts and hands
 * back a run's worktree lives in `./worktree`.
 *
 * See `projection.ts` for why the baseline exists and what it costs to get
 * wrong; it is the whole of the fix.
 */
export { createProjection, hashContent } from "./projection";
export type { Projection, ProjectionOptions } from "./projection";
export { createMemoryPlace } from "./memory-place";
export type { MemoryPlace } from "./memory-place";
export { createHostPlace } from "./host-place";
export type { HostPlace } from "./host-place";
export { PlaceUnreadableError } from "./types";
export type {
  FlushOutcome,
  FlushReport,
  Mount,
  Place,
  ProjectedEntryState,
} from "./types";
export { claimKey, createClaimRegistry, sharedClaimRegistry } from "./claims";
export type { ClaimHolder, ClaimRegistry } from "./claims";
export {
  collectionIdFor,
  frameComponents,
  principalFromContext,
  scopeComponents,
  unscopedCollectionId,
} from "./scope-identity";
export type { ScopeName, ScopePrincipal } from "./scope-identity";
export { localWorkspaceHost, WorkspaceRefusedError } from "./local-host";
export type { IgnoredDirectory } from "./worktree";
export { isStrictlyInside } from "./worktree";
export { CHECKOUT_CLEANUP_TIMEOUT_MS, GIT_TIMEOUT_MS, run } from "./exec";
export type { RunOptions } from "./exec";
export { acquireLock, releaseLock, sleep } from "./lock";
export type { AcquireOptions, LockBounds, LockLease } from "./lock";
export { identityFromCommonDir, repositoryIdentity, resolvesToCommit } from "./repository";
export type {
  LocalWorkspaceHostOptions,
  PlaceRequest,
  WorkspaceHost,
  WorkspacePlace,
} from "./local-host";
export type {
  FilesRunSource,
  RepoRunSource,
  RunFiles,
  RunSource,
  RunSourceAnswer,
  RunSourceRefusal,
} from "./run-source";
