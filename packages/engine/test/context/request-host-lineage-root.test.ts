/**
 * FIX-1068: a detached spawn passes the lineage id on, unchanged.
 *
 * The address a shared resource stores under is a value the root minted, not
 * something each session works out for itself. So the only thing a spawn has to
 * do is copy it — there is no root to locate, no parent chain to walk, and
 * nothing for two sessions to disagree about. Depth is the case that shows it:
 * a workstream spawned from inside a workstream carries the same id as the
 * conversation at the top, because it was handed the same value twice.
 */
import { describe, expect, it } from "vitest";
import type { FlowInstance } from "@flow-state-dev/core";
import { createRequestHost } from "../../src/context/create-request-host";
import { createInMemoryStores } from "../../src";
import type { StoreRegistry } from "../../src/stores/types";

/** Only `kind` and `workstream` are read by the verb under test. */
const FLOW = {
  kind: "lineage-seam",
  workstream: { block: { name: "core" } }
} as unknown as FlowInstance;

/** Spawn a child from `sessionId`, which belongs to lineage `lineageId`. */
async function spawnChild(stores: StoreRegistry, sessionId: string, lineageId: string) {
  const { host } = createRequestHost({
    stores,
    flow: FLOW,
    identity: {
      userId: "u_alice",
      tenantId: undefined,
      orgId: undefined,
      sessionId,
      lineageId
    },
    startOperation: async () => ({ requestId: "req_child" }),
    liveness: {}
  });

  const result = await host.startDetached({ seed: { topic: "review" }, input: {} });
  if (!result.ok) throw new Error(`spawn refused: ${result.refused}`);
  const record = await stores.session.get(result.sessionId);
  if (record === undefined) throw new Error("child record was not written");
  return record;
}

describe("FIX-1068: the lineage id is inherited at detached spawn", () => {
  it("copies the spawning session's lineage onto the child", async () => {
    const stores = createInMemoryStores();
    const child = await spawnChild(stores, "s_root", "lin_alpha");

    expect(child.parentSessionId).toBe("s_root");
    expect(child.lineageId).toBe("lin_alpha");
  });

  it("carries the same lineage at depth 2, with no root to re-derive", async () => {
    const stores = createInMemoryStores();
    const child = await spawnChild(stores, "s_root", "lin_alpha");

    // The child now spawns its own workstream, passing on what it holds.
    const grandchild = await spawnChild(stores, child.id, child.lineageId!);

    expect(grandchild.parentSessionId).toBe(child.id);
    expect(grandchild.lineageId).toBe("lin_alpha");
  });

  it("gives a different lineage a different child address", async () => {
    // Two conversations, two minted ids, two lineages — nothing about the
    // session ids or the owner participates, so a reused session id cannot
    // bring two lineages together.
    const stores = createInMemoryStores();
    const a = await spawnChild(stores, "s_shared_id", "lin_alpha");
    const b = await spawnChild(stores, "s_shared_id", "lin_beta");

    expect(a.lineageId).toBe("lin_alpha");
    expect(b.lineageId).toBe("lin_beta");
  });
});
