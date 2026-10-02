/**
 * A running request's items are readable while it runs (FIX-1735).
 *
 * The runtime writes a request's record when it starts and again when it
 * settles; everything a read of the session sees in between comes from the
 * items it persists as each one lands. On the in-memory stores those writes
 * once went nowhere, so a long run (a coding harness working for minutes) read
 * as having no items at all, then every item at once when it finished.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { createFilesystemStores, createInMemoryStores, runAction, type StoreRegistry } from "../src";

describe("a running request's items", () => {
  it("are in the store as each one lands, before the request settles, without its transient ones", async () => {
    const stores = createInMemoryStores();
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let landed!: () => void;
    const stepsLanded = new Promise<void>((resolve) => {
      landed = resolve;
    });

    const flow = defineFlow({
      kind: "in-flight-items",
      actions: {
        work: {
          inputSchema: z.object({}),
          block: handler({
            name: "long-work",
            inputSchema: z.object({}),
            outputSchema: z.object({}),
            execute: async (_input, ctx) => {
              ctx.emit.status("Reading the brief.", { transient: false });
              ctx.emit.status("Thinking…");
              ctx.emit.status("Editing the file.", { transient: false });
              landed();
              await finished;
              return {};
            }
          })
        }
      }
    })();

    const run = runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "work",
      input: {},
      requestId: "req_in_flight",
      userId: "user_in_flight",
      sessionId: "sess_in_flight",
      stores,
      runtimeConfig: {}
    });
    await stepsLanded;
    await stores.request.flushItems("req_in_flight");

    const running = await stores.request.get("req_in_flight");
    expect(running?.status).toBe("in_progress");
    const texts = (running?.items ?? [])
      .filter((item) => item.type === "status")
      .map((item) => (item as { message?: string }).message);
    expect(texts).toEqual(["Reading the brief.", "Editing the file."]);
    expect((running?.items ?? []).some((item) => item.transient === true)).toBe(false);

    // The session's listing reads the same items, as every stored read does.
    const listed = await stores.request.list({ sessionId: "sess_in_flight", withItems: true });
    expect(listed.flatMap((record) => record.items ?? []).map((item) => item.id)).toEqual(
      (running?.items ?? []).map((item) => item.id)
    );

    finish();
    await run;
    const settled = await stores.request.get("req_in_flight");
    expect(settled?.status).toBe("completed");
    expect((settled?.items ?? []).map((item) => item.id)).toEqual(
      expect.arrayContaining((running?.items ?? []).map((item) => item.id))
    );
  });
});

// The request's record is written in full whenever its state changes, from a
// snapshot the run took when it started. Items that landed since are not on
// that snapshot, so a state write in the middle of a run must not take them
// off the stored record: a read would show them, then lose them until another
// item landed or the request settled. In production a state change is
// live-only, so no item follows the write to put them back.
describe.each([
  ["in-memory", async () => ({ stores: createInMemoryStores(), cleanup: async () => {} })],
  [
    "filesystem",
    async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-in-flight-"));
      return {
        stores: createFilesystemStores({ rootDir, developmentOnly: true }),
        cleanup: () => rm(rootDir, { recursive: true, force: true })
      };
    }
  ]
] as const)("a running request's items on the %s stores", (_name, open) => {
  it("stay in the store across a request-state write in the middle of the run", async () => {
    const { stores, cleanup }: { stores: StoreRegistry; cleanup: () => Promise<void> } = await open();
    vi.stubEnv("NODE_ENV", "production");
    try {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      // An item reaches the store a little after it is emitted; wait until
      // `count` status items are written.
      const statusesStored = async (count: number): Promise<void> => {
        for (let attempt = 0; attempt < 200; attempt++) {
          await stores.request.flushItems("req_in_flight_state");
          const stored = await stores.request.get("req_in_flight_state");
          if ((stored?.items ?? []).filter((item) => item.type === "status").length >= count) return;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error(`${count} status items never reached the store`);
      };
      let afterWrite: Awaited<ReturnType<StoreRegistry["request"]["get"]>>;
      let wrote!: () => void;
      const stateWritten = new Promise<void>((resolve) => {
        wrote = resolve;
      });

      const flow = defineFlow({
        kind: "in-flight-items-state",
        request: { stateSchema: z.object({ phase: z.string().default("idle") }) },
        actions: {
          work: {
            inputSchema: z.object({}),
            block: handler({
              name: "long-work",
              inputSchema: z.object({}),
              outputSchema: z.object({}),
              execute: async (_input, ctx) => {
                // Each item is written before the state changes, as it is
                // when a run works for a while between the two.
                ctx.emit.status("Reading the brief.", { transient: false });
                await statusesStored(1);
                await ctx.request.setState({ phase: "editing" });
                ctx.emit.status("Editing the file.", { transient: false });
                await statusesStored(2);
                await ctx.request.setState({ phase: "testing" });
                // Read right after the write, before anything else can
                // persist the items again.
                afterWrite = await stores.request.get("req_in_flight_state");
                wrote();
                await finished;
                return {};
              }
            })
          }
        }
      })();

      const run = runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "work",
        input: {},
        requestId: "req_in_flight_state",
        userId: "user_in_flight",
        sessionId: "sess_in_flight",
        stores,
        runtimeConfig: {}
      });
      await stateWritten;
      const running = afterWrite;
      expect(running?.status).toBe("in_progress");
      expect(running?.state).toMatchObject({ phase: "testing" });
      const texts = (running?.items ?? [])
        .filter((item) => item.type === "status")
        .map((item) => (item as { message?: string }).message);
      expect(texts).toEqual(["Reading the brief.", "Editing the file."]);

      finish();
      await run;
    } finally {
      vi.unstubAllEnvs();
      await cleanup();
    }
  });
});
