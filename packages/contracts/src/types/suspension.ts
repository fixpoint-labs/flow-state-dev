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
