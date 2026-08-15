/**
 * Signals — what the world reported, or what reconciliation inferred was missed.
 *
 * A signal is the only thing that moves an entity. `decide` reduces one signal
 * at a time against a world snapshot, so the signal vocabulary is the complete
 * surface conductor responds to.
 *
 * Two properties this file exists to keep true:
 *
 * - **Reconciliation adds no new signal kinds.** A missed `pr_opened` is
 *   re-emitted as an ordinary `pr_opened` carrying `synthesized: true` and a
 *   backdated `at`, so it reduces ahead of the comment that revealed the gap.
 * - **A model may produce a signal; it may never produce an action.** The three
 *   prose-derived kinds (`feedback_received`, `question_asked`,
 *   `approval_expressed`) are classifier output. Everything else is structural.
 *   `approval_expressed` is advisory and must never satisfy an approval gate —
 *   a gate reads a real review state, never a model's reading of prose.
 *
 * The types are the contract; {@link signalSchema} at the bottom is the same
 * shape as runtime data, because a ledger row stores the signal a transition
 * was reduced from and a stored thing needs a schema.
 */

import { z } from "zod";

/** Every signal kind conductor responds to. */
export type SignalKind =
  // — structural, from GitHub state —
  | "pr_opened"
  | "review_submitted"
  | "changes_requested"
  | "approved"
  | "ci_concluded"
  | "merge_conflict"
  | "base_recovered"
  | "merged"
  | "pr_closed"
  // — prose-derived, from the classifier (M3+; M1 emits `feedback_received` only) —
  | "feedback_received"
  | "question_asked"
  | "approval_expressed"
  // — conductor's own —
  | "phase_entered"
  | "dispatch_completed"
  | "dispatch_failed"
  | "progress_stalled"
  // — the goal harness —
  | "goal_check_needed"
  | "goal_check_passed"
  | "goal_check_failed"
  // — ambient —
  | "guidance_changed"
  | "external_status_changed"
  // — epic —
  | "objective_approved"
  | "issue_settled";

/** Fields every signal carries. */
export interface SignalBase {
  readonly kind: SignalKind;
  /** The entity this signal is about — an issue id or an epic id. */
  readonly entityId: string;
  /**
   * When the underlying event happened, ISO-8601. Reconciliation backdates
   * synthesized signals to the event's inferred time so ordering is preserved.
   */
  readonly at: string;
  /** True when reconciliation inferred this rather than observing it live. */
  readonly synthesized?: boolean;
}

/**
 * CI concluded on a head SHA.
 *
 * `pullNumber` scopes the conclusion to the PR it ran on, for the same reason
 * {@link ReviewStateSignal} carries it: an issue in `IMPLEMENTATION` still has
 * its spec PR sitting there, and conductor reads both. Without the scope, a
 * check failing on the spec PR reduces as a failure of the implementation and
 * dispatches an agent to fix code that is fine.
 *
 * Optional, because a check-run webhook does not always name a PR and because
 * ledger rows written before this field existed must still parse. When it is
 * absent the `sha` still scopes the signal — `decide` rejects a conclusion
 * whose SHA is not the active artifact's head.
 */
export interface CiConcludedSignal extends SignalBase {
  readonly kind: "ci_concluded";
  readonly conclusion: "success" | "failure";
  readonly sha: string;
  readonly pullNumber?: number;
}

/**
 * A human submitted a review with an explicit state.
 *
 * `pullNumber` is load-bearing, not bookkeeping: an issue in `IMPLEMENTATION`
 * still has its spec PR sitting there, and without knowing which PR a review
 * landed on, a late approval on the spec would read as an approval of the
 * implementation.
 */
export interface ReviewStateSignal extends SignalBase {
  readonly kind: "review_submitted" | "changes_requested" | "approved";
  readonly reviewer: string;
  readonly sha: string;
  readonly pullNumber: number;
}

/** A pull request changed structural state. */
export interface PullRequestSignal extends SignalBase {
  readonly kind: "pr_opened" | "merged" | "pr_closed" | "merge_conflict" | "base_recovered";
  readonly pullNumber: number;
}

/** Classifier output over a human comment. Scoped to the PR it was left on. */
export interface ProseSignal extends SignalBase {
  readonly kind: "feedback_received" | "question_asked" | "approval_expressed";
  readonly author: string;
  readonly commentId: string;
  readonly pullNumber: number;
}

/** A dispatched phase execution settled. */
export interface DispatchSignal extends SignalBase {
  readonly kind: "dispatch_completed" | "dispatch_failed";
  readonly dispatchId: string;
}

/** A guidance document's content hash moved. */
export interface GuidanceChangedSignal extends SignalBase {
  readonly kind: "guidance_changed";
  readonly path: string;
}

/** A child issue passed its goal check. */
export interface IssueSettledSignal extends SignalBase {
  readonly kind: "issue_settled";
  readonly childId: string;
}

/**
 * Signals that carry no payload beyond the base fields.
 *
 * `goal_check_needed` and `progress_stalled` are the two worth a word, and they
 * are the same kind of thing: a statement about durable state rather than about
 * an event, derived on every tick rather than remembered.
 *
 * `goal_check_needed` reports that **the work in front of the entity holds no
 * passing proof on the ground it now needs** — a revision nothing has checked, a
 * proof a push left behind, or a submission that has merged and whose branch
 * proof says nothing about what landed. It carries no payload for the same
 * reason `progress_stalled` does not: the situation is read back out of the
 * world the row already stores, and a second copy on the signal is a second
 * source of truth that disagrees the moment the row is replayed. It is the only
 * thing that dispatches `runGoalCheck`, and being derived rather than observed
 * is what makes re-proving a transition of the lifecycle rather than a lucky
 * consequence of some other signal happening to arrive.
 *
 * `progress_stalled` reports that the entity has
 * **nothing left that could move it** — no gate of its phase applies, the phase
 * cannot complete, and its entry work has settled — which is a statement about
 * durable state rather than about an event, and is therefore derived on every
 * tick rather than remembered (`runtime/tick`'s `stalled`). It carries no
 * payload because it names nothing: the situation it reports is read back out of
 * the world the row already stores, which is what keeps one row from holding two
 * sources of truth about the same fact.
 */
export interface PlainSignal extends SignalBase {
  readonly kind:
    | "phase_entered"
    | "goal_check_needed"
    | "goal_check_passed"
    | "goal_check_failed"
    | "progress_stalled"
    | "external_status_changed"
    | "objective_approved";
}

/** The discriminated union `decide` reduces over. */
export type Signal =
  | CiConcludedSignal
  | ReviewStateSignal
  | PullRequestSignal
  | ProseSignal
  | DispatchSignal
  | GuidanceChangedSignal
  | IssueSettledSignal
  | PlainSignal;

/**
 * Signal kinds a model is allowed to produce. Everything else must come from a
 * structural read, so a misclassification can never invent a merge or an
 * approval.
 */
export const PROSE_DERIVED_KINDS = [
  "feedback_received",
  "question_asked",
  "approval_expressed",
] as const satisfies readonly SignalKind[];

/** True when `kind` is classifier output rather than a structural observation. */
export function isProseDerived(kind: SignalKind): boolean {
  return (PROSE_DERIVED_KINDS as readonly string[]).includes(kind);
}

/** Fields every variant carries, spread into each option below. */
const base = {
  entityId: z.string(),
  at: z.string(),
  synthesized: z.boolean().optional(),
};

/**
 * {@link Signal} as runtime data — one option per interface in the union above,
 * in the same order.
 *
 * Annotated with the union so a variant whose shape drifts from its interface
 * fails to compile. The annotation cannot catch a variant that is *missing*
 * altogether (a narrower union is still assignable), so totality over
 * `SignalKind` is held by a test that round-trips every kind rather than by the
 * type system.
 */
export const signalSchema: z.ZodType<Signal> = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("ci_concluded"),
    conclusion: z.enum(["success", "failure"]),
    sha: z.string(),
    // Optional so a row written before the field existed still parses (BP-030).
    pullNumber: z.number().int().optional(),
  }),
  z.object({
    ...base,
    kind: z.enum(["review_submitted", "changes_requested", "approved"]),
    reviewer: z.string(),
    sha: z.string(),
    pullNumber: z.number().int(),
  }),
  z.object({
    ...base,
    kind: z.enum(["pr_opened", "merged", "pr_closed", "merge_conflict", "base_recovered"]),
    pullNumber: z.number().int(),
  }),
  z.object({
    ...base,
    kind: z.enum(["feedback_received", "question_asked", "approval_expressed"]),
    author: z.string(),
    commentId: z.string(),
    pullNumber: z.number().int(),
  }),
  z.object({
    ...base,
    kind: z.enum(["dispatch_completed", "dispatch_failed"]),
    dispatchId: z.string(),
  }),
  z.object({ ...base, kind: z.literal("guidance_changed"), path: z.string() }),
  z.object({ ...base, kind: z.literal("issue_settled"), childId: z.string() }),
  z.object({
    ...base,
    kind: z.enum([
      "phase_entered",
      "goal_check_needed",
      "goal_check_passed",
      "goal_check_failed",
      "progress_stalled",
      "external_status_changed",
      "objective_approved",
    ]),
  }),
]);
