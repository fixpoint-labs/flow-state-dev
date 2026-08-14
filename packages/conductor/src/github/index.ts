/**
 * The GitHub half of a tick: read the world, turn what changed into signals,
 * and write back.
 *
 * ```
 * pollGitHub() ──▶ { world, signals } ──▶ decide() ──▶ Action[] ──▶ operations
 * ```
 *
 * The division of labour across this directory:
 *
 * | Module | Owns |
 * |---|---|
 * | `client` | auth, pagination, typed errors. Nothing domain-shaped. |
 * | `identity` | who counts as a human. The guard the signal path rests on. |
 * | `read-world` | GitHub → `World`, driven by the facts gates declare. |
 * | `signals` | payloads → `Signal[]`, structural only, no classifier. |
 * | `poll` | the tick's read path: fresh read + reconcile + comment cursor. |
 * | `operations` | outbound PR writes. Never a merge. |
 * | `blocks` | the same operations as FSD handler blocks. |
 *
 * Everything here is I/O at the edges and plain data in the middle, which is
 * what lets `decide` stay pure: by the time a gate predicate runs, the answer
 * it needs is already a field on a snapshot.
 */

export {
  createGitHubClient,
  GitHubApiError,
  isPendingReviewConflict,
  type FetchLike,
  type GitHubClient,
  type GitHubClientOptions,
} from "./client";

export {
  createIdentity,
  isHumanActor,
  type ActorEvidence,
  type ConductorIdentity,
  type GitHubActor,
  type IdentityOptions,
} from "./identity";

export {
  aggregateChecks,
  readPullRequest,
  readWorld,
  toObservedPr,
  type ReadWorldInput,
  type ReadWorldResult,
} from "./read-world";

export {
  signalFromComment,
  signalsFromWebhook,
  type CommentFacts,
  type SignalParseContext,
  type WebhookDelivery,
} from "./signals";

export {
  EMPTY_POLL_CURSOR,
  pollGitHub,
  type PollCursor,
  type PollInput,
  type PollResult,
} from "./poll";

export {
  commentOnPullRequest,
  openPullRequest,
  replyToReviewThreads,
  setLabels,
  submitReview,
  type OpenedPullRequest,
  type OpenPullRequestInput,
  type ReviewLineComment,
  type ReviewThreadReply,
  type SubmitReviewInput,
} from "./operations";

export { createGitHubPrBlocks, type GitHubPrBlocks } from "./blocks";
