/**
 * Integration tests for the `setInstructions` action. Verifies the write
 * path persists to the user store, exercises `flowIsolation: true` (key
 * lands at `${userId}:trading-desk`, not bare `${userId}`), and confirms
 * patch semantics across multiple writes.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/server";
import { testFlow } from "@flow-state-dev/testing";
import tradingDeskFlow from "../src/flows/trading-desk/flow";

const USER_ID = "devuser";
const ISOLATED_KEY = `${USER_ID}:trading-desk`;
// User-scope resources are stored under the resource's `ref` from
// `defineResource(...)` — not under the accessor name on the flow's
// resources map. Snapshot reads via `useResource(session, "specialInstructions")`
// use the accessor name; direct store inspection uses the ref.
const STORAGE_KEY = "tradingDeskSpecialInstructions";

describe("setInstructions action", () => {
  it("persists instructions to the user store under the flow-isolated key", async () => {
    const stores = createInMemoryStores();

    const result = await testFlow({
      flow: tradingDeskFlow,
      action: "setInstructions",
      userId: USER_ID,
      stores,
      input: {
        global: "Prefer short horizons.",
        phase1: "Weight balance-sheet quality.",
        phase2: "",
        phase3: "",
        phase4: "",
        phase5: "",
      },
    });

    expect(result.status).toBe("completed");
    expect(result.error).toBeUndefined();

    // flowIsolation: true → record lives at `${userId}:trading-desk`,
    // not at the bare `${userId}`.
    const isolated = await stores.user.get(ISOLATED_KEY);
    expect(isolated, `record at ${ISOLATED_KEY}`).toBeDefined();
    // Resource state lives in the ResourceStateStore (FIX-689), keyed by the
    // (isolated) user record id, not inline on the record.
    const resources = await stores.resourceState.getAll("user", ISOLATED_KEY);
    const persisted = resources[STORAGE_KEY] as
      | Record<string, string>
      | undefined;
    expect(persisted).toBeDefined();
    expect(persisted?.global).toBe("Prefer short horizons.");
    expect(persisted?.phase1).toBe("Weight balance-sheet quality.");
    expect(persisted?.phase2).toBe("");

    // Bare userId record should not exist at all — flowIsolation routes
    // every read/write to the namespaced key.
    const bare = await stores.user.get(USER_ID);
    expect(bare).toBeUndefined();
  });

  it("overwrites prior state on subsequent writes (patch semantics)", async () => {
    const stores = createInMemoryStores();

    await testFlow({
      flow: tradingDeskFlow,
      action: "setInstructions",
      userId: USER_ID,
      stores,
      input: {
        global: "v1 global",
        phase1: "v1 phase1",
        phase2: "",
        phase3: "",
        phase4: "",
        phase5: "",
      },
    });

    await testFlow({
      flow: tradingDeskFlow,
      action: "setInstructions",
      userId: USER_ID,
      stores,
      input: {
        global: "v2 global",
        phase1: "",
        phase2: "v2 phase2",
        phase3: "",
        phase4: "",
        phase5: "",
      },
    });

    const resources = await stores.resourceState.getAll("user", ISOLATED_KEY);
    const persisted = resources[STORAGE_KEY] as
      | Record<string, string>
      | undefined;
    expect(persisted?.global).toBe("v2 global");
    expect(persisted?.phase1).toBe("");
    expect(persisted?.phase2).toBe("v2 phase2");
  });
});
