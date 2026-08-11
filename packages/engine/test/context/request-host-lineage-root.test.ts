/**
 * FIX-1068: `startDetached` stamps the lineage root on the child it creates.
 *
 * The root is the address a `sharedToWorkstream` resource resolves to, so it has
 * to be the SAME value for every session in a chain. Stamping it at creation —
 * the parent's root, or the parent itself when the parent has none — is what
 * makes a resource read O(1) instead of a walk up `parentSessionId`, and it is
 * safe because a child never changes parents.
 *
 * The depth-2 case is the one worth pinning: a workstream spawned from inside a
 * workstream must inherit the ROOT, not name its immediate parent, or a
 * three-deep lineage ends up holding two copies of a resource it declared once.
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

/**
 * Spawn a child from `sessionId`, whose own lineage root is `root` (omit for a
 * session that IS the root), and hand back the record that was written.
 */
async function spawnChild(
  stores: StoreRegistry,
  sessionId: string,
  root: string | undefined
) {
  const { host } = createRequestHost({
    stores,
    flow: FLOW,
    identity: {
      userId: "u_alice",
      tenantId: undefined,
      orgId: undefined,
      sessionId,
      lineageRootSessionId: root
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

describe("FIX-1068: lineage root stamped at detached spawn", () => {
  it("names the spawning session as the root when that session has none", async () => {
    const stores = createInMemoryStores();
    const child = await spawnChild(stores, "s_root", undefined);

    expect(child.parentSessionId).toBe("s_root");
    expect(child.lineageRootSessionId).toBe("s_root");
  });

  it("inherits the root rather than naming the immediate parent, at depth 2", async () => {
    const stores = createInMemoryStores();
    const child = await spawnChild(stores, "s_root", undefined);

    // The child now spawns its own workstream, carrying the root it was stamped
    // with. The grandchild's parent is the child; its root is still s_root.
    const grandchild = await spawnChild(stores, child.id, child.lineageRootSessionId);

    expect(grandchild.parentSessionId).toBe(child.id);
    expect(grandchild.lineageRootSessionId).toBe("s_root");
  });
});
