/**
 * Pure suspension-status leaf types consumed by the item taxonomy, and the one
 * test of whether a suspension waits for a user (FIX-2129). The full
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
  /**
   * A person stopped the parked turn (FIX-1816). Absent on records written
   * before it existed; a reader that does not know it treats it as resolved.
   */
  | "stopped"
  /**
   * The suspension's task was cancelled while it waited, or the board
   * cancelled this one stop (FIX-2129). The block reads it and runs to its
   * end. A reader that does not know it treats it as resolved.
   */
  | "cancelled";

/**
 * Why a block suspended. The well-known reasons are enumerated; the open
 * `string & {}` arm lets callers carry custom reasons without losing
 * autocomplete on the known set.
 */
export type SuspensionReason =
  | "human_approval"
  | "human_input"
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

/**
 * What a suspension for a user asks for (`ctx.waitForUser`, FIX-2129):
 *
 * - `approval`: a yes or a no. At a deadline, a no.
 * - `review`: a verdict on work the user looks at.
 * - `input`: an answer the code reads on its next line.
 *
 * Never a question: a question with a task row holds its task instead.
 */
export type WaitForUserKind = "approval" | "review" | "input";

/** The suspension reasons that wait for a user. */
const USER_REASONS: ReadonlySet<string> = new Set(["human_approval", "human_input"]);

/**
 * Whether a suspension waits for a user: the one predicate every reader keys
 * on (the claim gate, the answer route, the Inbox). True for a
 * `ctx.waitForUser` stop and for a raw `ctx.suspend` with `human_approval` or
 * `human_input`. `external_event` and a custom reason (the open `string & {}`
 * arm of {@link SuspensionReason}) are never a user's.
 */
export function isUserSuspension(suspension: { readonly reason: string }): boolean {
  return USER_REASONS.has(suspension.reason);
}

/**
 * The kind of a user's suspension: its own `kind`, or, on a record that
 * carries none (a raw `ctx.suspend`), read from its reason: `human_approval`
 * an approval, `human_input` input. `undefined` for a suspension that does
 * not wait for a user.
 */
export function waitForUserKindOf(suspension: {
  readonly reason: string;
  readonly kind?: WaitForUserKind | undefined;
}): WaitForUserKind | undefined {
  if (!isUserSuspension(suspension)) return undefined;
  if (suspension.kind !== undefined) return suspension.kind;
  return suspension.reason === "human_approval" ? "approval" : "input";
}
