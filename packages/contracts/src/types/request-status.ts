/**
 * Pure request-lifecycle leaf type consumed by the item/stream taxonomy. The
 * `RequestStatusSnapshot` projection (a server/client read-model concern)
 * stays in `core/types/request.ts`, which re-exports this union from here.
 */

/**
 * Lifecycle status of a request. Mirrors the value persisted in
 * `RequestStore.set`. Server's `RequestRecord.status` re-exports this type.
 */
export type RequestStatus =
  | "in_progress"
  | "completed"
  | "incomplete"
  | "failed"
  | "interrupted"
  | "aborted"
  | "suspended";
