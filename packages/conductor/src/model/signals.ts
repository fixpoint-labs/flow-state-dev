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
 * - **A model may produce a signal; it may never produce an action.** The
 *   prose-derived kinds (`feedback_received`, `question_asked`) are classifier
 *   output. Everything else is structural, and no gate ever turns on a
 *   classifier's reading of prose — an approval gate reads a real review state.
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
  // — conductor's own —
  | "phase_entered"
  | "dispatch_completed"
  | "dispatch_failed"
  | "progress_stalled"
  // — the goal harness —
  | "goal_check_needed"
  | "goal_check_passed"
  | "goal_check_failed";

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
  readonly kind: "feedback_received" | "question_asked";
  readonly author: string;
  readonly commentId: string;
  readonly pullNumber: number;
}

/**
 * A dispatched phase execution settled.
 *
 * `detail` is why it failed, in the dispatcher's own words — `null` when it
 * completed, and `null` when it failed and said nothing.
 *
 * **It rides on the signal rather than being read back off the dispatch
 * record**, and that is forced rather than convenient. A ledger row stores an
 * action's kind and not its text, so the only thing that reproduces an
 * escalation's *reason* is re-running `decide` from the row's own signal —
 * and `decide` is pure over the signal and the world, with no collection to
 * fetch a reason from. A cause that lived only in the dispatch record would be
 * a transition the ledger cannot replay, which is the one invariant the ledger
 * exists to hold. It is not a second source of truth either: the record's
 * `detail` and this field are written from the same `DispatchResult.error` in
 * the same pass.
 *
 * Optional, so a row written before the field existed still parses (BP-030).
 * Absent and `null` mean the same thing — the dispatch named no cause — and
 * `decide` says so rather than rendering the gap at a human.
 */
export interface DispatchSignal extends SignalBase {
  readonly kind: "dispatch_completed" | "dispatch_failed";
  readonly dispatchId: string;
  readonly detail?: string | null;
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
    | "progress_stalled";
}

/** The discriminated union `decide` reduces over. */
export type Signal =
  | CiConcludedSignal
  | ReviewStateSignal
  | PullRequestSignal
  | ProseSignal
  | DispatchSignal
  | PlainSignal;

/**
 * Signal kinds a model is allowed to produce. Everything else must come from a
 * structural read, so a misclassification can never invent a merge or an
 * approval.
 */
export const PROSE_DERIVED_KINDS = [
  "feedback_received",
  "question_asked",
] as const satisfies readonly SignalKind[];

/** True when `kind` is classifier output rather than a structural observation. */
export function isProseDerived(kind: SignalKind): boolean {
  return (PROSE_DERIVED_KINDS as readonly string[]).includes(kind);
}

/**
 * Signal kinds conductor has **retired** — removed from the vocabulary above,
 * and still nameable by a ledger row written while they existed.
 *
 * A row is a transcript of a reduction that already happened, so one naming a
 * retired kind reads back with `signal: null` and its `signalKind` intact
 * (`./entities`): the row still says what arrived, and nothing pretends it can
 * be replayed. Replay was already gone the moment the branch that handled the
 * kind was deleted — a signal that still parsed would reduce to `[]` rather
 * than to the action the row records — so the only question this answers is
 * whether **reading** such a row crashes, and the whole ledger with it.
 *
 * It falls the same way `decide` does on an unrecognized signal, in that file's
 * own words: *unknown input is inert, never fatal.* The narrowness is the point
 * — this list, and nothing else. A malformed payload of a kind conductor still
 * handles is a real defect and still throws (BP-030).
 *
 * **Entries are permanent.** Removing one does not tidy anything up; it makes
 * the rows that named it start throwing again.
 */
export const RETIRED_SIGNAL_KINDS: readonly string[] = [
  "guidance_changed",
  "issue_settled",
  "objective_approved",
  "external_status_changed",
  "approval_expressed",
];

/**
 * True when `value` is a stored signal payload naming a retired kind.
 *
 * Deliberately structural and forgiving about everything else: it reads one
 * property off an object it does not otherwise trust, so a genuinely corrupt
 * row falls through to the schema and fails there rather than here.
 */
export function isRetiredSignal(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && RETIRED_SIGNAL_KINDS.includes(kind);
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
    kind: z.enum(["feedback_received", "question_asked"]),
    author: z.string(),
    commentId: z.string(),
    pullNumber: z.number().int(),
  }),
  z.object({
    ...base,
    kind: z.enum(["dispatch_completed", "dispatch_failed"]),
    dispatchId: z.string(),
    // Optional so a row written before the field existed still parses (BP-030).
    detail: z.string().nullable().optional(),
  }),
  z.object({
    ...base,
    kind: z.enum([
      "phase_entered",
      "goal_check_needed",
      "goal_check_passed",
      "goal_check_failed",
      "progress_stalled",
    ]),
  }),
]);
