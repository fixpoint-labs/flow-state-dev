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

function ctxFor(costPreset: "fast" | "full") {
  // Include an empty memos stub so the ledger context entry (which reads
  // `ctx.resources.memos`) resolves to null rather than throwing.
  return {
    session: { state: { costPreset } },
    resources: { memos: { getOptional: async () => undefined } },
  };
}

// corroborate/reviewReferences `context` is an ARRAY of verbatim entries (not an
// object map) so self-wrapping clauses render unescaped. Resolve every entry and
// return the non-null strings, joined — mirrors how the framework injects them.
async function resolveContext(
  preset: { context: unknown },
  ctx: unknown,
): Promise<string> {
  const entries = Array.isArray(preset.context)
    ? preset.context
    : [preset.context];
  const out: string[] = [];
  for (const e of entries) {
    const v = typeof e === "function" ? await e({}, ctx) : e;
    if (v != null) out.push(v as string);
  }
  return out.join("\n");
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

  it("injects the corroboration clause only on full", async () => {
    const onFull = await resolveContext(corroborate, ctxFor("full"));
    const onFast = await resolveContext(corroborate, ctxFor("fast"));
    expect(onFull).toContain("<corroboration>");
    expect(onFull).toContain("citations");
    // Exactly one opening tag — verbatim, not double-wrapped by an object key.
    expect(onFull.match(/<corroboration>/g)?.length).toBe(1);
    expect(onFast).not.toContain("<corroboration>");
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

  it("injects the reviewReferences clause only on full", async () => {
    const onFull = await resolveContext(reviewReferences, ctxFor("full"));
    const onFast = await resolveContext(reviewReferences, ctxFor("fast"));
    expect(onFull).toContain("<reviewReferences>");
    expect(onFull.match(/<reviewReferences>/g)?.length).toBe(1);
    expect(onFast).not.toContain("<reviewReferences>");
  });
});

describe("references ledger (folded into corroborate + reviewReferences)", () => {
  const emptyMemos = { getOptional: async () => undefined };
  // A memos collection where every key carries a citation (worst case for the
  // fast leak: a persisted full/verify run left citations behind).
  const memosWithCitation = {
    getOptional: async () => ({
      state: { citations: [{ url: "https://ex.com/x", title: "X" }] },
    }),
  };

  it("suppresses the tag on `fast` even when memos carry citations (structural gate)", async () => {
    // Regression for the fast-run leak: re-running a fast session that carries a
    // user thesis leaves run 1's ungated verify citations on the P6 memo; the
    // ledger must NOT surface them (and instruct tool-less agents to fetch) on
    // the fast re-run. The `full` gate on the folded context makes this impossible.
    // The ledger BLOCK is identified by its closing tag (the clause only
    // *mentions* the opening `<referencesConsulted>` inline, so we can't key on
    // that). On fast, no ledger block is emitted.
    const ctx = {
      session: { state: { costPreset: "fast" } },
      resources: { memos: memosWithCitation },
    };
    expect(await resolveContext(corroborate, ctx)).not.toContain(
      "</referencesConsulted>",
    );
    expect(await resolveContext(reviewReferences, ctx)).not.toContain(
      "</referencesConsulted>",
    );
  });

  it("suppresses the ledger block on `full` when nothing has been cited", async () => {
    const ctx = {
      session: { state: { costPreset: "full" } },
      resources: { memos: emptyMemos },
    };
    expect(await resolveContext(corroborate, ctx)).not.toContain(
      "</referencesConsulted>",
    );
  });

  it("renders the ledger block (unescaped) on `full` with citations", async () => {
    const ctx = {
      session: { state: { costPreset: "full" } },
      resources: { memos: memosWithCitation },
    };
    const rendered = await resolveContext(corroborate, ctx);
    expect(rendered).toContain("</referencesConsulted>");
    expect(rendered).toContain("https://ex.com/x");
    // Verbatim self-wrap: the ledger's own tags are NOT escaped, and it is not
    // double-wrapped (exactly one closing tag).
    expect(rendered).not.toContain("&lt;/referencesConsulted&gt;");
    expect(rendered.match(/<\/referencesConsulted>/g)?.length).toBe(1);
  });
});
