// FIX-2129.
/**
 * Pure suspension-status leaf types consumed by the item taxonomy, and the one
 * test of whether a suspension waits for a user. The full
 * suspension record/filter machinery (and its serialization concerns) stays
 * in `core/types/suspension.ts`, which re-exports these from here.
 */

/** Lifecycle status of a suspension. `pending` is the sole non-terminal state. */
export type SuspensionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "submitted"
  | "skipped"
  | "timed_out"
  | "expired"
  // FIX-1816.
  /**
   * A person stopped the parked turn. Absent on records written
   * before it existed; a reader that does not know it treats it as resolved.
   */
  | "stopped"
  // FIX-2129.
  /**
   * The suspension's task was cancelled while it waited, or the board
   * cancelled this one stop. The block reads it and runs to its
   * end. A reader that does not know it treats it as resolved.
   */
  | "cancelled";

/**
 * Why a block suspended. The well-known reasons are enumerated; the open
 * `string & {}` arm lets callers carry custom reasons without losing
 * autocomplete on the known set.
 */
export type SuspensionReason =
  | "user_approval"
  | "user_input"
  | "external_event"
  | (string & {});

/**
 * The resolution actions a resumer can send to the resume endpoint. `approve`
 * and `reject` are the original binary outcomes; `submit` carries a validated
 * payload (a question answer, a form, a selection); `skip` declines an optional
 * step so the run continues with a default. A leaf type so the item taxonomy
 * (`SuspensionItem.allow`) can reference it without depending on `core`.
 */
export type ResumeAction = "approve" | "reject" | "submit" | "skip";

// FIX-2129.
/**
 * What a suspension for a user asks for (`ctx.suspendForUser`):
 *
 * - `approval`: a yes or a no. At a deadline, a no.
 * - `review`: a verdict on work the user looks at.
 * - `input`: an answer the code reads on its next line.
 *
 * Never a question: a question with a task row holds its task instead.
 */
export type SuspendForUserKind = "approval" | "review" | "input";

/** The suspension reasons that wait for a user. */
const USER_REASONS: ReadonlySet<string> = new Set(["user_approval", "user_input"]);

/** A reason core 0.2.0 stored under its old `human_*` name, read as the `user_*` one. */
function currentReason(reason: string): string {
  if (reason === "human_approval") return "user_approval"; // retired-name-refusal: a stop core 0.2.0 stored
  if (reason === "human_input") return "user_input"; // retired-name-refusal: a stop core 0.2.0 stored
  return reason;
}

/**
 * Whether a suspension waits for a user: the one predicate every reader keys
 * on (the claim gate, the answer route, the Inbox). True for a
 * `ctx.suspendForUser` stop and for a raw `ctx.suspend` with `user_approval` or
 * `user_input`. `external_event` and a custom reason (the open `string & {}`
 * arm of {@link SuspensionReason}) are never a user's. A stop core 0.2.0
 * stored under its old `human_*` reason is a user's.
 */
export function isUserSuspension(suspension: { readonly reason: string }): boolean {
  return USER_REASONS.has(currentReason(suspension.reason));
}

/**
 * The kind of a user's suspension: its own `kind`, or, on a record that
 * carries none (a raw `ctx.suspend`), read from its reason: `user_approval`
 * an approval, `user_input` input. `undefined` for a suspension that does
 * not wait for a user.
 */
export function suspendForUserKindOf(suspension: {
  readonly reason: string;
  readonly kind?: SuspendForUserKind | undefined;
}): SuspendForUserKind | undefined {
  if (!isUserSuspension(suspension)) return undefined;
  if (suspension.kind !== undefined) return suspension.kind;
  return currentReason(suspension.reason) === "user_approval" ? "approval" : "input";
}
