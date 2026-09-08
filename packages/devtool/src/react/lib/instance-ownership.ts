/**
 * Who a record belongs to, answered once.
 *
 * The panel asks this in two places — restoring a saved session, and following a
 * ChildSession into whichever instance owns it — and both were previously
 * answered by comparing a flow KIND. A kind names a family, so two copies of one
 * kind agreed with each other and the panel would present one copy's session as
 * the other's. That is the whole defect this module exists to remove.
 *
 * The backend remains authoritative: it admits or refuses every read. What
 * happens here is presentation-side only — it stops the panel from *displaying*
 * a record under the wrong copy, and grants nothing.
 */
import type { FlowListEntry } from "@flow-state-dev/client";
import { ClientHttpError } from "@flow-state-dev/client";
import { errorBodyReason } from "./debug-errors";

/** The owner fields every session/request record projects. */
export type OwnedRecord = {
  /** Exact owning instance. Absent on a record written before owners existed. */
  flowId?: string;
  /** The record's actual flow kind — a family, never an identity. */
  flowKind: string;
};

/** The parts of a catalog entry an ownership question needs. */
export type InstanceIdentity = Pick<FlowListEntry, "id" | "kind" | "cardinality">;

/**
 * Does `record` belong to `instance`?
 *
 * Deliberately the same comparison as the engine's `ownsRecord`
 * (`engine/src/context/record-owner.ts`), which is the authority — this side
 * only decides what to *display*, and a presentation rule that disagrees with
 * the admission rule shows an operator something the server would refuse.
 *
 * Two rules, and the asymmetry between them is the point:
 *
 * - **An attributed record** (`flowId` present) matches its owner exactly, AND
 *   its recorded kind must agree with that instance's kind. A record whose two
 *   facts disagree is corrupt rather than repairable — reachable when an id is
 *   re-registered under a different kind, where matching on the id alone would
 *   hand the new flow the old one's sessions.
 * - **An unattributed record** — written before ownership was recorded — can be
 *   claimed only by a SINGLETON whose id is that kind, because a singleton has
 *   exactly one possible owner and nothing is being guessed. A collection member
 *   never claims one: any peer of that kind could be the real owner. The server
 *   answers such a read `409 migration-required` for the same reason; this
 *   simply declines to present it first.
 *
 * Kept in step by hand for now. Hoisting the shared predicate into
 * `@flow-state-dev/core` so there is one implementation is the right end state
 * and is tracked as a follow-up — not done here, because a cross-package move
 * under two stacked PRs is churn, and a half-finished one is worse than none
 * (BP-034).
 */
export function recordBelongsTo(record: OwnedRecord, instance: InstanceIdentity): boolean {
  if (record.flowId != null) {
    return record.flowId === instance.id && record.flowKind === instance.kind;
  }
  if (instance.cardinality !== "singleton") return false;
  return record.flowKind === instance.id;
}

/**
 * The instance to re-enter a suspended run through.
 *
 * A suspension carries its owner once one has been recorded. A record from
 * before that fell back to the kind, and for a singleton the kind IS the
 * address, which is why the fallback is correct rather than merely tolerated —
 * a collection member always has the explicit owner.
 */
export function suspensionOwnerId(record: { flowId?: string; flowKind: string }): string {
  return record.flowId ?? record.flowKind;
}

/**
 * Did the server answer conclusively that this record is not available to us,
 * as opposed to failing to answer?
 *
 * Only a conclusive refusal may be acted on destructively — discarding a saved
 * session hint, say. The line is drawn deliberately conservatively, because the
 * two mistakes cost different amounts: treating a permanent refusal as
 * transient costs one wasted revalidation next time, while treating a transient
 * failure as permanent throws away state the operator cannot get back.
 *
 * - **404 / 410** — conclusive. The session is not there.
 * - **409 `migration-required`** — conclusive. Its history cannot be attributed
 *   to any instance, and no retry changes that; only the offline migration does.
 * - **403** — conclusive. The server evaluated the request and refused it; a
 *   credential that could have helped was already attached.
 * - **401** — NOT conclusive. The credential may simply need refreshing, and a
 *   panel whose token expired must not delete every saved selection on the way.
 * - **5xx, a network failure, anything unrecognised** — not conclusive. The
 *   server never rendered a verdict.
 */
export function isConclusiveRefusal(err: unknown): boolean {
  if (isMigrationRequiredError(err)) return true;
  if (!(err instanceof ClientHttpError)) return false;
  return err.status === 404 || err.status === 410 || err.status === 403;
}

/**
 * True when the server refused a read because the record's history cannot be
 * attributed to one instance (`409 migration-required`).
 *
 * Surfaced as its own state rather than a generic failure: nothing the operator
 * can do in the panel fixes it, so the message has to say what actually will.
 */
export function isMigrationRequiredError(err: unknown): boolean {
  return errorBodyReason(err, 409) === "migration-required";
}

/**
 * The message to show for a failed read, with the unattributed-history case
 * spelled out instead of surfacing as "409".
 *
 * `fallback` is the caller's ordinary wording for a failure, kept so each
 * surface still says which read failed.
 */
export function describeReadError(err: unknown, fallback: string): string {
  if (isMigrationRequiredError(err)) {
    return (
      "This record's history predates flow instance ownership, so the server " +
      "cannot say which copy it belongs to. Attribute it to an instance on the " +
      "server before inspecting it here."
    );
  }
  return err instanceof Error ? err.message : fallback;
}
