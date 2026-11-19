/**
 * A request whose start fails ends `failed` (FIX-2849).
 *
 * Why it matters: a request left `in_progress` after its `onStarted` threw is
 * found by the stale sweep, marked interrupted, and brings its session's wakes
 * forward. A session whose every turn is refused at start (a fired worker's)
 * then starts a new request each time a wake fires, forever. A refused start is
 * terminal: nothing is left open for the sweep to pull a wake forward for.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAction } from "../src";
import { createInMemoryStores } from "../src/host";

describe("a request whose start fails", () => {
  it("is recorded failed, with the startup error, never left in_progress", async () => {
    const refuse = handler({
      name: "refuse",
      inputSchema: z.any(),
      execute: async () => {
        throw new Error("this turn can't run");
      }
    });
    const flow = defineFlow({
      kind: "startup-refused",
      request: { onStarted: refuse },
      actions: { run: { inputSchema: z.object({}), block: handler({ name: "noop", inputSchema: z.any(), execute: async () => ({}) }) } }
    })({ id: "startup-refused" });
    const stores = createInMemoryStores();

    await expect(
      runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", sessionId: "s1", stores, runtimeConfig: {} })
    ).rejects.toThrow("this turn can't run");

    const records = await stores.request.list();
    expect(records.map((record) => record.status)).toEqual(["failed"]);
    expect(JSON.stringify(records[0]!.result)).toContain("this turn can't run");
    // Nothing left registered for the stale sweep to find.
    expect(await stores.activeRequests.listAll()).toEqual([]);
  });
});
