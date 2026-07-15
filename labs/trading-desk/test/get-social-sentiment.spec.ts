/**
 * Tests for the `get_social_sentiment` router. Covers the three dispatch
 * routes (fixture / Grok / unavailable) plus direct execution of the two
 * handler-kind routes, plus record mode (the live route chained with a
 * recording tail). The Grok generator's end-to-end behavior is verified
 * by manual smoke test — building a model-stubbing harness for a single
 * generator is out of scope here, so the record tail is exercised
 * end-to-end through the unavailable route (the tail is route-agnostic)
 * and the Grok outcome is asserted at the wrapping seam. The recorder is
 * mocked; its filesystem behavior is covered by recorder.spec.ts.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _routesForTest,
  get_social_sentiment,
} from "../flows/analysis/tools/data/get_social_sentiment";
import { recordFixture } from "../flows/analysis/tools/runtime/recorder";

vi.mock("../flows/analysis/tools/runtime/recorder", () => ({
  recordFixture: vi.fn(async () => undefined),
}));

const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
  vi.clearAllMocks();
});
afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.XAI_API_KEY;
});

// Minimal ctx shape — the router execute reads
// `ctx.session.state.dataSource` via `pickMode`. Other ctx fields are
// not touched on the dispatch path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctx(dataSource: "fixture" | "live" | "record"): any {
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

describe("get_social_sentiment record mode", () => {
  it("records the unavailable payload and passes it through (no XAI key)", async () => {
    const input = { ticker: "NVDA", date: "2026-05-06" };
    const route = await selectRoute(input, ctx("record"));
    expect(route.name).toBe("get_social_sentiment.unavailable");

    // Run the selected route: the unavailable handler chained with the
    // recording tail. The tail must persist the `source: "unavailable"`
    // payload (a recorded provider miss replays as a miss, BP-020) and
    // return the payload unchanged.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (route as any).run(input, ctx("record"));

    expect(out.source).toBe("unavailable");
    expect(out.ticker).toBe("NVDA");
    expect(recordFixture).toHaveBeenCalledTimes(1);
    expect(recordFixture).toHaveBeenCalledWith("get_social_sentiment", input, out);
  });

  it("chains the recording tail onto the xai route (XAI key set)", async () => {
    process.env.XAI_API_KEY = "test-key";
    const input = { ticker: "NVDA", date: "2026-05-06" };

    // Live mode returns the bare adapted route — no recording wrapper.
    const liveRoute = await selectRoute(input, ctx("live"));
    expect(liveRoute).toBe(_routesForTest.grokAdaptedRoute);

    // Record mode returns a `connectOutput`-wrapped block: the same `.name`
    // (so router candidate validation still matches) but a new reference
    // carrying the recording tail. The tail is the same route-agnostic
    // mapper exercised end-to-end by the unavailable-outcome test above;
    // running the Grok generator itself needs a model harness (out of
    // scope — see file header).
    const recordRoute = await selectRoute(input, ctx("record"));
    expect(recordRoute.name).toBe("get_social_sentiment.xai");
    expect(recordRoute).not.toBe(_routesForTest.grokAdaptedRoute);
  });

  it("fixture mode never records — the fixture route is returned bare", async () => {
    // A record run never re-records what it replays; only the live
    // outcomes persist. Fixture mode keeps the untouched fixture route.
    const route = await selectRoute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("fixture"),
    );
    expect(route).toBe(_routesForTest.fixtureRoute);
  });
});

