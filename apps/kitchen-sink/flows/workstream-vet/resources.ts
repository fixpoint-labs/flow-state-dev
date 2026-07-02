/**
 * workstream-vet — resources and shared constants (throwaway tracer bullet).
 *
 * Prototype for the workstream vet spec (docs/internal/workstream-vet-tracer-bullet.md).
 * Two session-scoped resources:
 *
 * - `wsvetTasks` — the board. A wildcard resource collection whose instances
 *   ARE the tasks (`getOrCreateTaskCollection({ backing: "resource" })`
 *   creates one instance per task id). Session scope is what lets the board
 *   outlive a request — the seam Wave 1 deferred.
 * - `wsvetWorkspace` — the shared workspace every workstream member reads.
 *   Holds the goal, the current draft, and the human-feedback field the
 *   capability preset renders and the persist tap echoes.
 */
import { defineResource, defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

/** Stable id for the task collection (matches `task-change` items). */
export const BOARD_COLLECTION_ID = "wsvet-board";

/** The only model-backed worker; every draft/revise task carries this assignee. */
export const DRAFTER = "drafter";

/** Human tasks carry this assignee and are born `awaiting_review` (never claimable). */
export const HUMAN_APPROVER = "human:approver";

/**
 * Deterministic acceptance stand-in (spec: goal judgment must be exercised
 * independently of human approval). The goal check passes once this many
 * drafts exist — i.e. `minRevisions = MIN_DRAFTS - 1`.
 */
export const MIN_DRAFTS = 2;

/** Shared workspace state. Nullable-with-default per BP-023. */
export const workspaceStateSchema = z.object({
  goal: z.string().nullable().default(null),
  draft: z.string().nullable().default(null),
  draftsWritten: z.number().default(0),
  latestFeedback: z.string().nullable().default(null),
  /**
   * Deterministic data-path evidence (vet criterion 4b): stamped by the
   * persist tap from `latestFeedback` at generation time. Nothing else
   * writes it, so a non-null value is unambiguous.
   */
  feedbackEcho: z.string().nullable().default(null),
});
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;

export const workspaceResource = defineResource({
  ref: "wsvetWorkspace",
  scope: "session",
  stateSchema: workspaceStateSchema,
  default: {
    goal: null,
    draft: null,
    draftsWritten: 0,
    latestFeedback: null,
    feedbackEcho: null,
  },
});

/**
 * The board's backing collection. Instances are substrate `Task` objects
 * keyed by task id — the schema stays permissive because the task shape is
 * owned by `@flow-state-dev/tasks`, not this flow.
 */
export const workstreamTasksCollection = defineResourceCollection({
  scope: "session",
  pattern: "wsvetTasks/**",
  stateSchema: z.object({}).passthrough(),
});
