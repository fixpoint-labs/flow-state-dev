/**
 * The one interpretation of a stored record's owning flow instance.
 *
 * A session or request record carries two facts about its flow. `flowKind` is
 * the definition's kind — descriptive metadata, and the broad filter a
 * listing groups by. `flowId` is the **owner**: the exact instance the record
 * was created under, stamped from the resolved instance's `id`. Every reader
 * that turns a stored record back into a flow — re-entry, recovery, route
 * authorization, state/resource/debug reads, adoption — goes through this
 * module, so no reader resolves by stored kind on its own and no two readers
 * can disagree about who a record belongs to.
 *
 * Records written before `flowId` existed carry only `flowKind`. Those are
 * read compatibly for exactly one case: the singleton whose id is that kind,
 * which is what every registered flow was before instances could have a
 * distinct id. Anything else — a collection kind, or a kind whose name has
 * since been taken as another instance's exact id — is **ambiguous history**,
 * and is refused as `migration-required` rather than guessed. Runtime string
 * equality cannot discover which copy a deployment meant; the offline cutover
 * documented in `apps/docs/docs/persistence/overview.md` is what attributes it.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";

/** The two owner facts every owned record carries. `flowId` is absent on legacy rows. */
export type OwnedRecord = {
  flowKind: string;
  /** `null` and `undefined` both mean "written before the field existed" (BP-030). */
  flowId?: string | null;
};

/** Why a stored record could not be resolved to its owner. */
export type OwnerResolutionRefusal =
  /** The record names an owner instance that is not registered in this process. */
  | "owner-not-registered"
  /** The record's `flowId` resolves to an instance of a different kind than its `flowKind`. */
  | "owner-kind-mismatch"
  /** A legacy row whose history this runtime cannot attribute to one instance. */
  | "migration-required";

export type OwnerResolution =
  | { ok: true; flow: FlowInstance }
  | { ok: false; reason: OwnerResolutionRefusal; detail: string };

/**
 * Resolve the flow instance a stored record belongs to, or refuse by name.
 *
 * With a stored `flowId`, that id is authoritative: it must resolve, and the
 * resolved instance's kind must agree with the record's `flowKind` — a record
 * whose two facts disagree is corrupt, not repairable on read. Without one,
 * only known singleton history resolves; see the file header.
 */
export function resolveRecordOwner(
  registry: Pick<FlowRegistry, "get" | "list">,
  record: OwnedRecord
): OwnerResolution {
  if (record.flowId != null) {
    const flow = registry.get(record.flowId);
    if (flow === undefined) {
      return {
        ok: false,
        reason: "owner-not-registered",
        detail: `no flow instance "${record.flowId}" is registered in this process`
      };
    }
    if (flow.kind !== record.flowKind) {
      return {
        ok: false,
        reason: "owner-kind-mismatch",
        detail:
          `the record is owned by flow instance "${record.flowId}" of kind "${flow.kind}", ` +
          `but records its kind as "${record.flowKind}"`
      };
    }
    return { ok: true, flow };
  }

  const flow = registry.get(record.flowKind);
  if (flow === undefined) {
    // Nothing answers to the kind as an address. Either the kind is gone, or
    // it is a collection whose members are addressed by their own ids — and a
    // legacy row of a collection kind is exactly the history the offline
    // migration attributes. The scan runs on this refusal path only.
    const kindIsRegistered = registry.list().some((f) => f.kind === record.flowKind);
    return kindIsRegistered
      ? {
          ok: false,
          reason: "migration-required",
          detail:
            `the record predates instance ownership and names kind "${record.flowKind}", ` +
            `which is a collection; run the offline owner migration`
        }
      : {
          ok: false,
          reason: "owner-not-registered",
          detail: `no flow instance "${record.flowKind}" is registered in this process`
        };
  }
  // A hand-built structural instance may omit `cardinality`; it is the
  // singleton of its kind, exactly as the registry admits it (BP-030).
  if ((flow.cardinality ?? "singleton") !== "singleton" || flow.kind !== record.flowKind) {
    return {
      ok: false,
      reason: "migration-required",
      detail:
        `the record predates instance ownership and names kind "${record.flowKind}", which ` +
        `this runtime cannot attribute to one instance` +
        (flow.kind !== record.flowKind
          ? ` (the address "${record.flowKind}" now belongs to an instance of kind "${flow.kind}")`
          : ` (kind "${record.flowKind}" is a collection)`) +
        `; run the offline owner migration`
    };
  }
  return { ok: true, flow };
}

/**
 * The three identity facts an owner comparison reads. A `FlowInstance`
 * satisfies it directly; a caller that holds only the facts (an expected
 * child identity, say) passes them without building an instance.
 */
export type OwnerIdentity = Pick<FlowInstance, "kind"> &
  Partial<Pick<FlowInstance, "id" | "cardinality">>;

/**
 * Whether `flow` is the instance a stored record belongs to. The comparison
 * side of {@link resolveRecordOwner}: a request that already holds its
 * resolved instance asks this before touching a record it loaded.
 *
 * A legacy row (no `flowId`) belongs to the singleton of its kind and to
 * nothing else — never to a collection member, and never to a different kind
 * whose instance id happens to equal the stored kind.
 */
export function ownsRecord(flow: OwnerIdentity, record: OwnedRecord): boolean {
  // A hand-built structural instance may carry neither field; its identity is
  // the singleton of its kind, exactly as the registry admits it (BP-030).
  const flowId = flow.id ?? flow.kind;
  const cardinality = flow.cardinality ?? "singleton";
  if (record.flowId != null) {
    return record.flowId === flowId && record.flowKind === flow.kind;
  }
  return cardinality === "singleton" && flow.kind === record.flowKind;
}

/**
 * Why a record `ownsRecord` refused belongs to someone else, for the error a
 * caller raises when it holds the addressed instance but no registry. The
 * same verdict {@link resolveRecordOwner} reaches for the two legacy shapes it
 * can name without one: a row of the addressed instance's own kind that now
 * runs as a collection, and a row whose kind's address this instance has
 * taken under another kind — both `migration-required`, the stop condition an
 * operator acts on, not a wrong address. Every other refusal, a foreign
 * legacy row of some other kind included, names the owner the row claims.
 */
export function foreignRecordRefusal(
  flow: OwnerIdentity,
  record: OwnedRecord
): { detail: string; reason: OwnerResolutionRefusal | undefined } {
  if (record.flowId == null) {
    const sameKind = record.flowKind === flow.kind;
    if (sameKind && (flow.cardinality ?? "singleton") === "collection") {
      return {
        detail:
          `it was written before instance ownership existed and its kind "${record.flowKind}" ` +
          `now runs as a collection, so its owner must be attributed by migration`,
        reason: "migration-required"
      };
    }
    if (!sameKind && (flow.id ?? flow.kind) === record.flowKind) {
      return {
        detail:
          `it was written before instance ownership existed and names kind "${record.flowKind}", ` +
          `whose address now belongs to an instance of kind "${flow.kind}", so its owner must be ` +
          `attributed by migration`,
        reason: "migration-required"
      };
    }
  }
  return { detail: `it belongs to flow instance "${recordOwnerId(record)}"`, reason: undefined };
}

/**
 * The owner id a record is filed under, for grouping and filtering: the
 * stored `flowId`, or for a legacy row the singleton id its kind implies.
 * This is a label, not an authorization — a reader deciding access resolves
 * the owner through {@link resolveRecordOwner} instead.
 */
export function recordOwnerId(record: OwnedRecord): string {
  return record.flowId ?? record.flowKind;
}
