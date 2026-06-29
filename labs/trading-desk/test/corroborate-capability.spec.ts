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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

// The search-exposing presets gate the `search` tool on a configured provider
// key (the resolver throws with none), so these tests control the env to make
// the tool count deterministic regardless of the CI environment.
const SEARCH_KEYS = [
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "PERPLEXITY_API_KEY",
  "SERPER_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "PARALLEL_API_KEY",
];
let savedKeys: Record<string, string | undefined>;

beforeEach(() => {
  savedKeys = Object.fromEntries(SEARCH_KEYS.map((k) => [k, process.env[k]]));
  for (const k of SEARCH_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of SEARCH_KEYS) {
    if (savedKeys[k] === undefined) delete process.env[k];
    else process.env[k] = savedKeys[k];
  }
});

describe("corroborate preset", () => {
  it("exposes search + fetch on full when a search provider key is set", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    const tools = await corroborate.tools(ctxFor("full"));
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(2);
    expect(tools.every((t: { name?: unknown }) => typeof t.name === "string")).toBe(
      true,
    );
  });

  it("drops search (fetch only) on full when no search provider key is set", async () => {
    // The resolver throws with no key, so the preset must not hand the model a
    // search tool that would abort the generator on first call.
    const tools = await corroborate.tools(ctxFor("full"));
    expect(tools.length).toBe(1);
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
