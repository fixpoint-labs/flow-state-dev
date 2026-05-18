/**
 * Tests for the `get_social_sentiment` router. Covers the three dispatch
 * routes (fixture / Grok / unavailable) plus direct execution of the two
 * handler-kind routes. The Grok generator's end-to-end behavior is
 * verified by manual smoke test — building a model-stubbing harness for
 * a single generator is out of scope here.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _routesForTest,
  get_social_sentiment,
} from "../src/flows/trading-desk/phase-1/tools/get_social_sentiment";

const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
});
afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.XAI_API_KEY;
});

// Minimal ctx shape — the router execute reads
// `ctx.session.state.dataSource` via `pickMode`. Other ctx fields are
// not touched on the dispatch path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctx(dataSource: "fixture" | "live"): any {
  return { session: { state: { dataSource } } };
}

// The router's TS type narrows `config.execute` to the runtime output
// shape (`TOutput`), but the route-selection function we passed to
// `router({...})` actually returns a `BlockDefinition`. Cast through so
// the test can assert on which route was picked.
const selectRoute = get_social_sentiment.config.execute! as unknown as (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: { ticker: string; date: string }, ctx: any,
) => Promise<{ name: string }> | { name: string };

const fixtureExecute = _routesForTest.fixtureRoute.config.execute!;
const unavailableExecute = _routesForTest.unavailableRoute.config.execute!;

describe("get_social_sentiment router dispatch", () => {
  it("selects the fixture route in fixture mode", async () => {
    const route = await selectRoute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("fixture"),
    );
    expect(route.name).toBe("get_social_sentiment.fixture");
  });

  it("selects the unavailable route in live mode without XAI_API_KEY", async () => {
    const route = await selectRoute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("live"),
    );
    expect(route.name).toBe("get_social_sentiment.unavailable");
  });

  it("selects the xai route in live mode when XAI_API_KEY is set", async () => {
    process.env.XAI_API_KEY = "test-key";
    const route = await selectRoute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("live"),
    );
    // `connectOutput` preserves the inner block's `.name`. Router
    // validation accepts the adapted block by name match.
    expect(route.name).toBe("get_social_sentiment.xai");
  });
});

describe("get_social_sentiment leaf routes", () => {
  it("fixture route loads the curated fixture", async () => {
    const out = await fixtureExecute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("fixture"),
    );
    expect(out.source).toBe("fixture");
    expect(out.ticker).toBe("NVDA");
    expect(typeof out.score7d).toBe("number");
  });

  it("unavailable route returns a zeroed schema-valid payload", async () => {
    const out = await unavailableExecute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("live"),
    );
    expect(out.source).toBe("unavailable");
    expect(out.ticker).toBe("NVDA");
    expect(out.score7d).toBe(0);
    expect(out.positive).toBe(0);
    expect(out.negative).toBe(0);
    expect(out.neutral).toBe(0);
    // `null` rather than `0` — we can't measure short interest off X
    // chatter, and a fabricated 0 would read as "no shorts" to the analyst.
    expect(out.shortInterestPct).toBeNull();
    expect(out.posts).toEqual([]);
  });

  it("fixture route carries representative posts the analyst can quote", async () => {
    const out = await fixtureExecute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("fixture"),
    );
    // The fixture is the canonical example of what the live route should
    // produce — losing `posts` here means we'd silently revert the
    // analyst back to score-only reasoning.
    expect(Array.isArray(out.posts)).toBe(true);
    expect(out.posts.length).toBeGreaterThan(0);
    for (const p of out.posts) {
      expect(typeof p.handle).toBe("string");
      expect(typeof p.excerpt).toBe("string");
      expect(["positive", "negative", "neutral"]).toContain(p.polarity);
    }
  });
});

