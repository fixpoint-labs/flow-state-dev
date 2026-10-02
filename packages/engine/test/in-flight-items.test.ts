/**
 * A running request's items are readable while it runs (FIX-1735).
 *
 * The runtime writes a request's record when it starts and again when it
 * settles; everything a read of the session sees in between comes from the
 * items it persists as each one lands. On the in-memory stores those writes
 * once went nowhere, so a long run (a coding harness working for minutes) read
 * as having no items at all, then every item at once when it finished.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "../src";

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
