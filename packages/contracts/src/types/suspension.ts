/**
 * Pure suspension-status leaf types consumed by the item taxonomy. The full
 * suspension record/filter machinery (and its serialization concerns) stays
 * in `core/types/suspension.ts`, which re-exports these two unions from here.
 */

/** Lifecycle status of a suspension. `pending` is the sole non-terminal state. */
export type SuspensionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "submitted"
  | "skipped"
  | "timed_out"
  | "expired";

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
