/**
 * FIX-1068: a `{ key }` dispatch passes the lineage id on, unchanged.
 *
 * The address a shared resource stores under is a value the root minted, not
 * something each session works out for itself. So the only thing a dispatch has
 * to do is copy it — there is no root to locate, no parent chain to walk, and
 * nothing for two sessions to disagree about. Depth is the case that shows it:
 * a child dispatched from inside a child carries the same id as the
 * conversation at the top, because it was handed the same value twice.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../../src";
import type { StoreRegistry } from "../../src/stores/types";
import { dispatchableFlow, spawnChild } from "./seam-harness";

const FLOW = dispatchableFlow("lineage-seam");

/** Dispatch a child from `sessionId`, which belongs to lineage `lineageId`. */
async function childOf(stores: StoreRegistry, sessionId: string, lineageId: string) {
  const childId = await spawnChild(stores, FLOW, "review", {
    identity: { userId: "u_alice", tenantId: undefined, orgId: undefined, sessionId, lineageId }
  });
  const record = await stores.session.get(childId);
  if (record === undefined) throw new Error("child record was not written");
  return record;
}

describe("FIX-1068: the lineage id is inherited at dispatch", () => {
  it("copies the dispatching session's lineage onto the child", async () => {
    const stores = createInMemoryStores();
    const child = await childOf(stores, "s_root", "lin_alpha");

    expect(child.parentSessionId).toBe("s_root");
    expect(child.lineageId).toBe("lin_alpha");
  });

  it("carries the same lineage at depth 2, with no root to re-derive", async () => {
    const stores = createInMemoryStores();
    const child = await childOf(stores, "s_root", "lin_alpha");

    // The child now dispatches its own child, passing on what it holds.
    const grandchild = await childOf(stores, child.id, child.lineageId!);

    expect(grandchild.parentSessionId).toBe(child.id);
    expect(grandchild.lineageId).toBe("lin_alpha");
  });

  it("gives a different lineage a different child address", async () => {
    // Two conversations, two minted ids, two lineages — nothing about the
    // session ids or the owner participates, so a reused session id cannot
    // bring two lineages together.
    const stores = createInMemoryStores();
    const a = await childOf(stores, "s_shared_id", "lin_alpha");
    const b = await childOf(stores, "s_shared_id", "lin_beta");

    expect(a.id).not.toBe(b.id);
    expect(a.lineageId).toBe("lin_alpha");
    expect(b.lineageId).toBe("lin_beta");
  });
});
