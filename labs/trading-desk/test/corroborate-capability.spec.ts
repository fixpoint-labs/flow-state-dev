/**
 * Verifies the synthesis-phase web-search presets' gating contract (FIX-676),
 * mirroring `investigate-capability.spec.ts`:
 *
 *   - `corroborate` — exposes `search` + `fetch` and the `<corroboration>`
 *     clause only on `costPreset === "full"`; `[]` / `null` on `fast`.
 *   - `reviewReferences` — exposes `fetch` (no search) and the
 *     `<reviewReferences>` clause only on full; `[]` / `null` on `fast`.
 *   - `referencesConsulted` — read-only context, suppressed (`null`) when no
 *     memo has cited anything.
 *
 * The preset resolvers are the contract; we call them directly off `__presetDefs`
 * rather than routing through a full flow.
 */
import { describe, expect, it } from "vitest";
import { tradingDesk } from "../src/flows/analysis/capability";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCap = any;
const defs = (tradingDesk as AnyCap).__presetDefs;
const corroborate = defs.corroborate;
const reviewReferences = defs.reviewReferences;
const referencesConsulted = defs.referencesConsulted;

function ctxFor(costPreset: "fast" | "full") {
  return { session: { state: { costPreset } }, resources: {} };
}

describe("corroborate preset", () => {
  it("exposes search + fetch on the full preset", async () => {
    const tools = await corroborate.tools(ctxFor("full"));
    expect(Array.isArray(tools)).toBe(true);
    // Two tools: a web search and a fetch.
    expect(tools.length).toBe(2);
    expect(tools.every((t: { name?: unknown }) => typeof t.name === "string")).toBe(
      true,
    );
  });

  it("exposes no tools on the fast preset", async () => {
    expect(await corroborate.tools(ctxFor("fast"))).toEqual([]);
  });

  it("injects the corroboration clause only on full", () => {
    const onFull = corroborate.context.corroboration({}, ctxFor("full"));
    const onFast = corroborate.context.corroboration({}, ctxFor("fast"));
    expect(typeof onFull).toBe("string");
    expect(onFull).toContain("<corroboration>");
    expect(onFull).toContain("citations");
    expect(onFast).toBeNull();
  });
});

describe("reviewReferences preset", () => {
  it("exposes a single fetch tool (no search) on full", async () => {
    const tools = await reviewReferences.tools(ctxFor("full"));
    expect(tools.length).toBe(1);
    expect(typeof tools[0].name).toBe("string");
  });

  it("exposes no tools on the fast preset", async () => {
    expect(await reviewReferences.tools(ctxFor("fast"))).toEqual([]);
  });

  it("injects the reviewReferences clause only on full", () => {
    const onFull = reviewReferences.context.reviewReferences({}, ctxFor("full"));
    const onFast = reviewReferences.context.reviewReferences({}, ctxFor("fast"));
    expect(typeof onFull).toBe("string");
    expect(onFull).toContain("<reviewReferences>");
    expect(onFast).toBeNull();
  });
});

describe("referencesConsulted preset", () => {
  it("suppresses the tag (null) when nothing has been cited", async () => {
    const ctx = {
      session: { state: { costPreset: "full" } },
      resources: { memos: { getOptional: async () => undefined } },
    };
    const value = await referencesConsulted.context.referencesConsulted({}, ctx);
    expect(value).toBeNull();
  });
});
