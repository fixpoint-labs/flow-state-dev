/**
 * `@flow-state-dev/workspace` — the file projection, the workspace host built
 * on it, the host's turn-end check for the pull requests on a checkout's
 * branch (`./branch-pull-requests`), and the user's list of worktrees the host
 * writes (`./worktrees`).
 *
 * One piece of machinery moving file content between resource collections and
 * wherever an agent works, so the shell path and the coding path share a
 * behaviour instead of drifting apart with a copy each. The host
 * (`./local-host`) turns a run source's answer (`./run-source`) into that
 * place: a branch of a repository, or a set of kept files, and reads the
 * same files without making one (`./source-read`), and can run the
 * operator's setup command in each checkout it makes (`./setup`). Every git process
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
export { fileHeldWorkStore, HeldWorkMismatchError } from "./held-work";
export type { HeldWork, HeldWorkMismatchField, HeldWorkStore, RecordedHold, SkippedPath } from "./held-work";
export type { IgnoredDirectory, MovedBack, OffBranch } from "./worktree";
export type { PlaceSetup, WorkspaceSetup } from "./setup";
export { isStrictlyInside } from "./worktree";
export { CHECKOUT_CLEANUP_TIMEOUT_MS, GIT_TIMEOUT_MS, run } from "./exec";
export { BRANCH_PULL_REQUESTS_TIMEOUT_MS, pullRequestHead, recordBranchPullRequests } from "./branch-pull-requests";
export type {
  BranchPullRequestsContext,
  BranchPullRequestsResult,
  PullRequestHead,
  PullRequestHeadOptions,
  RecordBranchPullRequestsOptions,
} from "./branch-pull-requests";
export type { RunOptions } from "./exec";
export {
  WORKTREES,
  worktreeAttachedSchema,
  worktreeKey,
  worktreeName,
  worktreeOwnerSchema,
  worktreePullRequestSchema,
  worktreeRowSchema,
  worktreesCollection,
  worktreeStateSchema,
} from "./worktrees";
export type { CheckoutSnapshot } from "./worktrees";
export type { WorktreeAttached, WorktreeCollection, WorktreeOwner, WorktreePullRequest, WorktreeRecording, WorktreeRow, WorktreeState } from "./worktrees";
export { acquireLock, releaseLock, sleep, tryAcquireLock } from "./lock";
export { checkedOutBranch, occupyWorktree, worktreeLockPath } from "./occupancy";
export type { AcquireOptions, LockBounds, LockLease } from "./lock";
export { identityFromCommonDir, repositoryIdentity, resolvesToCommit } from "./repository";
export { redactRemote } from "./remotes";
export type {
  ListedWorktree,
  LocalWorkspaceHostOptions,
  PlaceOrigin,
  PlaceRequest,
  RecordedPlace,
  RemovedWorktree,
  RemoveOptions,
  RemoveTarget,
  WorkspaceHost,
  WorkspacePlace,
} from "./local-host";
export { SOURCE_READ_FRESH_MS, SOURCE_READ_LIMITS } from "./source-read";
export type { GrepDialect, SourceReadAt, SourceReadCut, SourceReadRequest, SourceReadResult } from "./source-read";
export type {
  FilesRunSource,
  RepoRunSource,
  RunFiles,
  RunSource,
  RunSourceAnswer,
  RunSourceRefusal,
} from "./run-source";
