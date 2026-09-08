/**
 * The one interpretation of a stored record's owner: a stamped `flowId` is
 * authoritative, legacy history resolves only to a known singleton, and every
 * ambiguous shape refuses by name rather than guessing a copy.
 */
import { defineFlow } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { createFlowRegistry, ownsRecord, resolveRecordOwner } from "../src";
import { foreignRecordRefusal } from "../src/context/record-owner";

function registryWith(...flows: Parameters<ReturnType<typeof createFlowRegistry>["register"]>[0][]) {
  const registry = createFlowRegistry();
  registry.registerMany(flows);
  return registry;
}

const engineer = defineFlow({ kind: "engineer", cardinality: "collection", actions: {} });
const billing = defineFlow({ kind: "billing", cardinality: "collection", actions: {} });
const reports = defineFlow({ kind: "reports", actions: {} });

describe("resolveRecordOwner", () => {
  it("resolves a stamped owner by exact id and validates its kind", () => {
    const registry = registryWith(engineer({ id: "engineer-a" }), engineer({ id: "engineer-b" }));
    const owner = resolveRecordOwner(registry, { flowKind: "engineer", flowId: "engineer-b" });
    expect(owner.ok && owner.flow.id).toBe("engineer-b");

    const mismatch = resolveRecordOwner(registry, { flowKind: "billing", flowId: "engineer-a" });
    expect(!mismatch.ok && mismatch.reason).toBe("owner-kind-mismatch");

    const gone = resolveRecordOwner(registry, { flowKind: "engineer", flowId: "engineer-c" });
    expect(!gone.ok && gone.reason).toBe("owner-not-registered");
  });

  it("reads known singleton history compatibly and refuses collection history", () => {
    const registry = registryWith(reports(), engineer({ id: "engineer-a" }));
    const legacySingleton = resolveRecordOwner(registry, { flowKind: "reports" });
    expect(legacySingleton.ok && legacySingleton.flow.id).toBe("reports");

    // One registered member proves nothing about which copy the row meant.
    const lone = resolveRecordOwner(registry, { flowKind: "engineer", flowId: null });
    expect(!lone.ok && lone.reason).toBe("migration-required");
  });

  it("never hands a legacy kind to an unrelated instance whose id is that kind's name", () => {
    const registry = registryWith(engineer({ id: "engineer-a" }), billing({ id: "engineer" }));
    const collided = resolveRecordOwner(registry, { flowKind: "engineer" });
    expect(!collided.ok && collided.reason).toBe("migration-required");
    // The exact address still resolves the billing instance for a stamped row.
    const stamped = resolveRecordOwner(registry, { flowKind: "billing", flowId: "engineer" });
    expect(stamped.ok && stamped.flow.kind).toBe("billing");
  });
});

describe("ownsRecord", () => {
  it("matches a stamped row on id and kind, and a legacy row only on its singleton", () => {
    const east = engineer({ id: "engineer-a" });
    expect(ownsRecord(east, { flowKind: "engineer", flowId: "engineer-a" })).toBe(true);
    expect(ownsRecord(east, { flowKind: "engineer", flowId: "engineer-b" })).toBe(false);
    expect(ownsRecord(east, { flowKind: "engineer" })).toBe(false);

    const singleton = reports();
    expect(ownsRecord(singleton, { flowKind: "reports" })).toBe(true);
    expect(ownsRecord(singleton, { flowKind: "reports", flowId: "reports" })).toBe(true);
    expect(ownsRecord(billing({ id: "reports" }), { flowKind: "reports" })).toBe(false);
  });
});

describe("foreignRecordRefusal", () => {
  it("names a migration only for the legacy shapes resolveRecordOwner refuses that way", () => {
    const east = engineer({ id: "engineer-a" });
    // A collection member reaching an ownerless row of its own kind: the
    // history it cannot attribute.
    expect(foreignRecordRefusal(east, { flowKind: "engineer" }).reason).toBe("migration-required");
    // An ownerless row of ANOTHER kind is a wrong address, not a migration —
    // its owner is that kind's singleton, whatever the addressed instance is.
    const foreign = foreignRecordRefusal(east, { flowKind: "reports" });
    expect(foreign.reason).toBeUndefined();
    expect(foreign.detail).toContain('"reports"');
    // The kind's address taken by an instance of another kind.
    expect(foreignRecordRefusal(billing({ id: "engineer" }), { flowKind: "engineer" }).reason).toBe(
      "migration-required"
    );
    // A stamped row always names its owner.
    const stamped = foreignRecordRefusal(east, { flowKind: "engineer", flowId: "engineer-b" });
    expect(stamped.reason).toBeUndefined();
    expect(stamped.detail).toContain('"engineer-b"');
  });

  it("agrees with resolveRecordOwner on every legacy shape it can name", () => {
    const registry = registryWith(reports(), engineer({ id: "engineer-a" }), billing({ id: "engineer" }));
    for (const [flow, record] of [
      [engineer({ id: "engineer-a" }), { flowKind: "engineer" }],
      [engineer({ id: "engineer-a" }), { flowKind: "reports" }],
      [billing({ id: "engineer" }), { flowKind: "engineer" }]
    ] as const) {
      const resolved = resolveRecordOwner(registry, record);
      const refusal = foreignRecordRefusal(flow, record);
      expect(refusal.reason === "migration-required").toBe(
        !resolved.ok && resolved.reason === "migration-required"
      );
    }
  });
});
