/**
 * The app's stored-work upgrade runs before its first router: a reply an
 * earlier version left unfinished under a worker's old door is renamed
 * before the router, and the durability sweep it starts, exists.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createInMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { afterStoredWorkUpgrade } from "@/lib/stored-work-upgrade";

describe("afterStoredWorkUpgrade", () => {
  it("renames an old door's unfinished request before the first router is built", async () => {
    const stores = createInMemoryStores();
    const now = Date.now();
    await stores.request.set(
      "old-reply",
      {
        orgId: DEFAULT_ORG_ID,
        id: "old-reply",
        flowKind: "agent",
        flowId: "agent",
        actionName: "run",
        userId: "u",
        status: "suspended",
        startedAtMs: now,
        state: {},
        version: 1,
        createdAt: now,
        updatedAt: now,
        incarnation: "inc-old",
        journal: [],
      } as never,
      "any",
    );
    const seenAtRouter: string[] = [];
    const flowstate = {
      getRuntime: async () => ({ stores }),
      getRouter: async () => {
        seenAtRouter.push((await stores.request.get("old-reply"))!.actionName);
        return {} as never;
      },
      ready: async () => {},
    } as unknown as FlowState;
    const upgraded = afterStoredWorkUpgrade(flowstate, [{ id: "agent", actions: { respond: {} } }]);
    await upgraded.getRouter();
    await upgraded.getRouter();
    expect(seenAtRouter).toEqual(["respond", "respond"]);
  });

  it("runs the upgrade before ready(), and fails the start when it fails", async () => {
    const order: string[] = [];
    const stores = createInMemoryStores();
    const flowstate = {
      getRuntime: async () => {
        order.push("upgrade");
        return { stores };
      },
      getRouter: async () => ({}) as never,
      ready: async () => void order.push("ready"),
    } as unknown as FlowState;
    await afterStoredWorkUpgrade(flowstate, []).ready();
    expect(order).toEqual(["upgrade", "ready"]);

    const broken = {
      getRuntime: async () => {
        throw new Error("the store is down");
      },
      getRouter: async () => ({}) as never,
      ready: async () => {},
    } as unknown as FlowState;
    const refusing = afterStoredWorkUpgrade(broken, []);
    await expect(refusing.ready()).rejects.toThrow("the store is down");
    await expect(refusing.getRouter()).rejects.toThrow("the store is down");
  });
});
