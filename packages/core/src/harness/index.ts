/**
 * `@flow-state-dev/core/harness` — the coding-harness vocabulary, on one
 * documented subpath.
 *
 * Three records live here: the harness contract (what a harness block is
 * handed and hands back, and the hooks a host feeds it through), the run's
 * plan record (the to-do list every harness writes into), and the session's
 * pull-request record (the pull requests a session opened). With them, the
 * helpers a harness package calls: its child process's environment, live
 * steering, activity, and the pull-request recorder.
 *
 * Isomorphic: browser code reads the plan and pull-request keys from here
 * without importing the package root.
 */

// LAB-152.
/** The harness contract: the run's input, envelope and handle, and the hooks a host wires. */
export {
  harnessFailureKind,
  harnessRunEnvelopeSchema,
  harnessRunHandleSchema,
  harnessRunInputSchema,
  harnessUsageWindowSchema,
  reportHarnessSpend,
} from "../types/harness";
export type {
  ClassifiedHarnessError,
  HarnessActivity,
  HarnessActivityHook,
  HarnessBilling,
  HarnessBlock,
  HarnessCallbackContext,
  HarnessCostBasis,
  HarnessFailureKind,
  HarnessModelInfo,
  HarnessModelList,
  HarnessReadiness,
  HarnessReadinessCheck,
  HarnessResolver,
  HarnessRunCost,
  HarnessRunEnvelope,
  HarnessRunHandle,
  HarnessRunInput,
  HarnessRunOutcome,
  HarnessRunSpend,
  HarnessRunStatus,
  HarnessRunUsage,
  HarnessSessionHook,
  HarnessSource,
  HarnessSteer,
  HarnessSteerHook,
  HarnessUsageHook,
  HarnessUsageLevel,
  HarnessUsageReader,
  HarnessUsageReading,
  HarnessUsageReport,
  HarnessUsageWindow,
} from "../types/harness";

/**
 * The run's plan record: the shape every harness writes its to-do list into,
 * the per-run list marker, and the writer for whole-list plans.
 */
export {
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  harnessConversationNamespace,
  harnessRunNamespace,
  observedOutcomeSchema,
  observedPlanCollection,
  observedPlanItemStateSchema,
  observedPlanListCollection,
  observedPlanListStateSchema,
  planKeySegment,
  planResourcesPrefix,
  readPlanTarget,
  replacePlanList,
} from "../types/harness-plan";
export type {
  ObservedOutcome,
  ObservedPlanListStatus,
  PlanListCollection,
  PlanListItem,
  PlanListMarkerCollection,
  PlanMarkerRead,
  ReplacePlanListResult,
} from "../types/harness-plan";

/**
 * The session's pull-request record: the rows, the rules that read a create
 * call, the one writer, and the recorder (a function harness blocks call, and
 * a block a flow adds as a step).
 */
export {
  DEFAULT_PULL_REQUEST_RULES,
  OBSERVED_PULL_REQUESTS,
  githubPullRequestRule,
  observedPullRequestStateSchema,
  observedPullRequestsCollection,
  pullRequestKey,
  pullRequestRefFromUrl,
  writePullRequests,
} from "../types/pull-requests";
export type {
  ObservedPullRequestState,
  PullRequestCollection,
  PullRequestLink,
  PullRequestRef,
  PullRequestRule,
  PullRequestSource,
  PullRequestToolCall,
  WritePullRequestsOptions,
} from "../types/pull-requests";
export { pullRequestRecorder, pullRequestWritesSettled, recordPullRequests } from "../helpers/pull-request-recorder";
export type { PullRequestRecorderContext, RecordPullRequestsOptions } from "../helpers/pull-request-recorder";

/** The allowlisted environment for a harness's child process, and the base every harness's list starts from. */
export { HARNESS_BASE_PASS, harnessEnv } from "../helpers/harness-env";
export type { HarnessEnvOptions } from "../helpers/harness-env";
/** One flow's live steering: the hook its harness is handed, and the action that hands a line in. */
export { harnessSteering } from "../helpers/harness-steering";
export type { HarnessSteerActionOptions, HarnessSteerAnswer, HarnessSteering } from "../helpers/harness-steering";
/** A harness's activity events, read off its stream and reported to the host's hook. */
export { harnessActivityOf, reportHarnessActivity } from "../helpers/harness-activity";
/** A run's duration, formatted the way every harness reports it. */
export { formatRunDuration } from "../helpers/run-duration";
