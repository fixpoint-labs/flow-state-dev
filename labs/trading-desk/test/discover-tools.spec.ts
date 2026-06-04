/**
 * Tests for the four `discover_*_context` handlers (FIX-612). Each tool
 * has the same four-branch matrix:
 *
 *   - costPreset "fast"           → skippedDiscoveryPayload, no provider call
 *   - costPreset "full" + fixture → fixture JSON, source="fixture"
 *   - costPreset "full" + live    → discoverWeb path, source="web"
 *   - costPreset "full" + provider missing → unavailable (BP-020: no fixture fallback)
 *
 * The four tools share a discipline, so the suite tests fundamentals
 * exhaustively (the canonical 4 branches) and adds a parametrised
 * lightweight check for the other three to guard against drift between
 * the files.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { _resetCache } from "../src/flows/trading-desk/tools/runtime/cache";
import { discover_fundamentals_context } from "../src/flows/trading-desk/tools/data/discover_fundamentals_context";
import { discover_sentiment_context } from "../src/flows/trading-desk/tools/data/discover_sentiment_context";
import { discover_technical_context } from "../src/flows/trading-desk/tools/data/discover_technical_context";
import { discover_profile_context } from "../src/flows/trading-desk/tools/data/discover_profile_context";
import { discoveryPayloadSchema } from "../src/flows/trading-desk/tools/schemas";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

// Use the runtime-isolated approach from get-company-profile.spec — vi.mock
// the resolver module so live-branch tests can assert behaviour without
// reaching for real env vars.
vi.mock("@flow-state-dev/tools/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/tools/search")>();
  return {
    ...actual,
    resolveProvider: vi.fn(),
  };
});
import { resolveProvider } from "@flow-state-dev/tools/search";
const mockResolveProvider = vi.mocked(resolveProvider);

const fixtureFlow = defineFlow({
  kind: "trading-desk-test",
  actions: {
    runFundamentals: { block: discover_fundamentals_context },
    runSentiment: { block: discover_sentiment_context },
    runTechnical: { block: discover_technical_context },
    runProfile: { block: discover_profile_context },
  },
  session: { stateSchema: sessionStateSchema },
})({ id: "test" });

function sessionFor(
  costPreset: "fast" | "full",
  dataSource: "fixture" | "live",
) {
  return {
    state: {
      ticker: "NVDA",
      date: "2026-05-06",
      costPreset,
      dataSource,
      activePhase: "idle" as const,
      memoStatus: {},
    },
  };
}

const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
  _resetCache();
  mockResolveProvider.mockReset();
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
});

describe("discover_fundamentals_context — full branch matrix", () => {
  it("returns source=skipped on the fast preset without calling the provider", async () => {
    const result = await testBlock(discover_fundamentals_context, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fast", "live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("skipped");
    expect(result.output.items).toEqual([]);
    expect(result.output.query).toBe("");
    // Cost gate fires before any provider lookup.
    expect(mockResolveProvider).not.toHaveBeenCalled();
  });

  it("loads the fixture on full + fixture", async () => {
    const result = await testBlock(discover_fundamentals_context, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("full", "fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    expect(result.output.items.length).toBeGreaterThan(0);
    // Numbering: ids are sequential strings starting at "1".
    expect(result.output.items[0].id).toBe("1");
    expect(result.output.items[0].url).toMatch(/^https?:\/\//);
  });

  it("returns source=web on full + live with a configured provider", async () => {
    mockResolveProvider.mockReturnValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: {
        name: "tavily",
        search: async () => ({
          query: "NVDA earnings",
          results: [
            {
              title: "NVDA earnings beat",
              url: "https://example.com/a",
              snippet: "good earnings",
              source: "tavily" as const,
            },
            {
              title: "guidance raised",
              url: "https://example.com/b",
              snippet: "outlook strong",
              source: "tavily" as const,
            },
          ],
        }),
      } as any,
      apiKey: "test-key",
    });
    const result = await testBlock(discover_fundamentals_context, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("full", "live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("web");
    expect(result.output.items.length).toBe(2);
    expect(result.output.items[0].id).toBe("1");
    expect(result.output.items[0].provider).toBe("tavily");
    expect(result.output.items[0].publisher).toBe("example.com");
    expect(result.output.query).toContain("NVDA");
  });

  it("returns source=unavailable on full + live when no provider is configured (BP-020: no fixture fallback)", async () => {
    mockResolveProvider.mockImplementation(() => {
      throw new Error("no provider key configured");
    });
    const result = await testBlock(discover_fundamentals_context, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("full", "live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(result.output.items).toEqual([]);
  });
});

describe("discover_*_context — parametrised wiring check across the three remaining tools", () => {
  const cases = [
    { name: "sentiment", block: discover_sentiment_context, queryContains: "sentiment" },
    { name: "technical", block: discover_technical_context, queryContains: "technical" },
    { name: "profile", block: discover_profile_context, queryContains: "announcement" },
  ] as const;

  it.each(cases)(
    "$name: fast → skipped",
    async ({ block }) => {
      const result = await testBlock(block, {
        input: { ticker: "NVDA", date: "2026-05-06" },
        flow: fixtureFlow,
        session: sessionFor("fast", "live"),
      });
      expect(result.output.source).toBe("skipped");
    },
  );

  it.each(cases)(
    "$name: full + fixture → fixture data with numbered items",
    async ({ block }) => {
      const result = await testBlock(block, {
        input: { ticker: "NVDA", date: "2026-05-06" },
        flow: fixtureFlow,
        session: sessionFor("full", "fixture"),
      });
      expect(result.error).toBeNull();
      expect(result.output.source).toBe("fixture");
      expect(result.output.items.length).toBeGreaterThan(0);
      expect(result.output.items[0].id).toBe("1");
    },
  );

  it.each(cases)(
    "$name: query template includes the role's signature term",
    async ({ block, queryContains }) => {
      mockResolveProvider.mockReturnValue({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        adapter: {
          name: "tavily",
          search: async (q: string) => ({ query: q, results: [] }),
        } as any,
        apiKey: "k",
      });
      const result = await testBlock(block, {
        input: { ticker: "NVDA", date: "2026-05-06" },
        flow: fixtureFlow,
        session: sessionFor("full", "live"),
      });
      expect(result.output.query.toLowerCase()).toContain(queryContains);
    },
  );
});

describe("discoveryPayloadSchema", () => {
  it("accepts the skipped, fixture, web, and unavailable shapes", () => {
    const base = { ticker: "NVDA", asOf: "2026-05-06", query: "", items: [] };
    for (const source of ["skipped", "fixture", "web", "unavailable"] as const) {
      expect(() => discoveryPayloadSchema.parse({ ...base, source })).not.toThrow();
    }
  });

  it("rejects an unknown source tag", () => {
    expect(() =>
      discoveryPayloadSchema.parse({
        source: "made-up",
        ticker: "NVDA",
        asOf: "2026-05-06",
        query: "",
        items: [],
      }),
    ).toThrow();
  });
});
