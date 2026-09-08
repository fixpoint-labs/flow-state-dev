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

/** The owner fields every session/request/child record projects. */
export type OwnedRecord = {
  /** Exact owning instance. Absent on a record written before owners existed. */
  flowId?: string;
  /** The record's actual flow kind — a family, never an identity. */
  flowKind?: string;
};

/** The parts of a catalog entry an ownership question needs. */
export type InstanceIdentity = Pick<FlowListEntry, "id" | "cardinality">;

/**
 * Does `record` belong to `instance`?
 *
 * Two rules, and the asymmetry between them is the point:
 *
 * - **An attributed record** (`flowId` present) matches its owner exactly. No
 *   kind comparison enters into it.
 * - **An unattributed record** — written before ownership was recorded — can be
 *   claimed only by a SINGLETON whose id is that kind, because a singleton has
 *   exactly one possible owner and nothing is being guessed. A collection member
 *   never claims one: any peer of that kind could be the real owner. The server
 *   answers such a read `409 migration-required` for the same reason; this
 *   simply declines to present it first.
 */
export function recordBelongsTo(record: OwnedRecord, instance: InstanceIdentity): boolean {
  if (record.flowId != null) return record.flowId === instance.id;
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
 * True when the server refused a read because the record's history cannot be
 * attributed to one instance (`409 migration-required`).
 *
 * Surfaced as its own state rather than a generic failure: nothing the operator
 * can do in the panel fixes it, so the message has to say what actually will.
 */
export function isMigrationRequiredError(err: unknown): boolean {
  if (!(err instanceof ClientHttpError)) return false;
  if (err.status !== 409) return false;
  const body = err.body;
  if (body === null || typeof body !== "object" || !("error" in body)) return false;
  return (body as { error?: unknown }).error === "migration-required";
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
