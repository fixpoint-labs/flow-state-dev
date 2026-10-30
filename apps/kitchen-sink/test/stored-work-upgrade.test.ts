/**
 * The app's stored-work upgrade runs before its first router, so the
 * durability sweep the router starts finds every board debt's wake owed.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { afterStoredWorkUpgrade } from "@/lib/stored-work-upgrade";

describe("afterStoredWorkUpgrade", () => {
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
    await afterStoredWorkUpgrade(flowstate).ready();
    expect(order).toEqual(["upgrade", "ready"]);

    const broken = {
      getRuntime: async () => {
        throw new Error("the store is down");
      },
      getRouter: async () => ({}) as never,
      ready: async () => {},
    } as unknown as FlowState;
    const refusing = afterStoredWorkUpgrade(broken);
    await expect(refusing.ready()).rejects.toThrow("the store is down");
    await expect(refusing.getRouter()).rejects.toThrow("the store is down");
  });
});
