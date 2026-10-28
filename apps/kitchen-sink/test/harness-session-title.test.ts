/**
 * A harness session's title, which every mode gets from the shared flow
 * (`lib/harness-session-flow.ts`) and none from its own block, so it is tested
 * against a stub harness rather than one mode's.
 *
 * Red states produced before these were trusted:
 *   - drop the "already titled" guard: the second turn retitles the session.
 *   - drop the empty-title guard: a whitespace-only prompt writes an empty title.
 */
import { createInMemoryStores } from "@flow-state-dev/engine";
import { handler } from "@flow-state-dev/core";
import { testFlow } from "@flow-state-dev/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { harnessSessionFlow, titleOf, type HarnessBlock } from "@/lib/harness-session-flow";

/** A harness that runs nothing and reports a completed run. */
const stubAgent = () =>
  handler({
    name: "stub-harness",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async () => ({ outcome: "completed" }),
  }) as unknown as HarnessBlock;

async function turn(stores: ReturnType<typeof createInMemoryStores>, sessionId: string, prompt: string) {
  return testFlow({
    flow: harnessSessionFlow({ kind: "stub-session", agent: stubAgent }),
    action: "turn",
    userId: "u",
    sessionId,
    input: { prompt },
    stores,
  });
}

describe("a harness session's title", () => {
  it("is its first prompt, so the rail lists a person's words rather than an id, and later turns keep it", async () => {
    const stores = createInMemoryStores();
    await turn(stores, "s-title", "Fix the flaky retry test\nit fails on CI only");
    expect((await stores.session.get("s-title"))?.title).toBe("Fix the flaky retry test");
    await turn(stores, "s-title", "now something else entirely");
    expect((await stores.session.get("s-title"))?.title).toBe("Fix the flaky retry test");
  });

  it("waits for a prompt with words in it, rather than writing an empty title", async () => {
    const stores = createInMemoryStores();
    await turn(stores, "s-blank", "   \n  ");
    expect((await stores.session.get("s-blank"))?.title).toBeUndefined();
    await turn(stores, "s-blank", "Now a real prompt");
    expect((await stores.session.get("s-blank"))?.title).toBe("Now a real prompt");
  });

  it("is one line, collapsed and cut to a length a rail can hold", () => {
    expect(titleOf("\n  a   b\tc  \nsecond")).toBe("a b c");
    const cut = titleOf("x".repeat(200));
    expect(cut).toHaveLength(60);
    expect(cut.endsWith("…")).toBe(true);
  });
});
