/**
 * The history summary's session resource has one definition: the one a
 * screen reads by session id (`useResource(historySummaryResource, { sessionId })`)
 * must be the one every `historySummary(...)` at the default name installs, or
 * the screen reads a resource by a name or a public face the flow doesn't keep.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "../src/blocks/handler";
import { historySummaryResource } from "../src/types";
import { historySummary } from "../src/utility";

const summarize = handler({
  name: "earlier-turns",
  inputSchema: z.object({ summary: z.string().nullable(), turns: z.array(z.any()) }),
  outputSchema: z.object({ summary: z.string() }),
  execute: () => ({ summary: "" }),
});

describe("the history summary's session resource", () => {
  it("is the exported definition wherever a summary keeps it at the default name", () => {
    expect(historySummary({ summarize }).resource).toBe(historySummaryResource);
    expect(historySummary({ summarize }).resource).toBe(historySummaryResource);
    expect(historySummaryResource).toMatchObject({ ref: "historySummary", scope: "session" });
  });

  it("shows a screen the summary's mark and whether it is whole, never its words", () => {
    expect(historySummaryResource.client).toEqual({ expose: ["throughRequestId", "complete", "folds"] });
  });

  it("is a definition of its own under another name", () => {
    const named = historySummary({ summarize, name: "earlierTurns" }).resource;
    expect(named).not.toBe(historySummaryResource);
    expect(named).toMatchObject({ ref: "earlierTurns", scope: "session" });
  });
});
