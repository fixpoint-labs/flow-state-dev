/**
 * Unit tests for the Massive (Polygon) provider client. Pins the response
 * normalization for both the option-chain snapshot and the futures front/next
 * resolution, the empty-but-successful answer, and the throw-on-non-2xx contract
 * the calling tools rely on for their `try/catch → unavailable` degrade.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchFuturesFrontNext,
  fetchOptionChainSnapshot,
  hasMassiveKey,
} from "../src/flows/analysis/tools/providers/massive";

/** Route a mocked `fetch` by URL substring → JSON payload (status 200). */
function mockFetchByUrl(routes: Array<{ match: string; payload: unknown }>, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const url = String(input instanceof URL ? input.href : input);
    const route = routes.find((r) => url.includes(r.match));
    return new Response(JSON.stringify(route?.payload ?? {}), { status });
  });
}

beforeAll(() => {
  process.env.MASSIVE_API_KEY = "test-key";
});
beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("hasMassiveKey", () => {
  it("is true when MASSIVE_API_KEY is set", () => {
    expect(hasMassiveKey()).toBe(true);
  });
});

describe("fetchOptionChainSnapshot", () => {
  it("normalizes contracts and captures the underlying spot", async () => {
    mockFetchByUrl([
      {
        match: "/v3/snapshot/options/",
        payload: {
          results: [
            {
              details: { strike_price: 100, expiration_date: "2026-05-15", contract_type: "call" },
              greeks: { delta: 0.52 },
              implied_volatility: 0.31,
              open_interest: 1200,
              day: { volume: 300 },
              underlying_asset: { price: 101.2 },
            },
            {
              details: { strike_price: 100, expiration_date: "2026-05-15", contract_type: "put" },
              greeks: { delta: -0.48 },
              implied_volatility: 0.35,
              open_interest: 900,
              day: { volume: 150 },
              underlying_asset: { price: 101.2 },
            },
          ],
        },
      },
    ]);

    const { spot, contracts } = await fetchOptionChainSnapshot("NVDA");
    expect(spot).toBe(101.2);
    expect(contracts).toHaveLength(2);
    expect(contracts[0]).toMatchObject({
      type: "call",
      strike: 100,
      expiry: "2026-05-15",
      iv: 0.31,
      delta: 0.52,
      openInterest: 1200,
      volume: 300,
    });
  });

  it("skips malformed rows and maps absent fields to null", async () => {
    mockFetchByUrl([
      {
        match: "/v3/snapshot/options/",
        payload: {
          results: [
            { details: { strike_price: 100, contract_type: "call" } }, // no expiry → skipped
            {
              details: { strike_price: 90, expiration_date: "2026-05-15", contract_type: "put" },
              // no greeks / iv / oi / volume
            },
          ],
        },
      },
    ]);
    const { spot, contracts } = await fetchOptionChainSnapshot("NVDA");
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({ type: "put", iv: null, delta: null, openInterest: null });
    expect(spot).toBeNull();
  });

  it("follows next_url to gather contracts across pages (≥2 expiries for the term structure)", async () => {
    // Page 1 carries the near expiry and points at page 2 via next_url; page 2
    // carries a later expiry. The term-structure read needs both.
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            results: [
              {
                details: { strike_price: 100, expiration_date: "2026-05-15", contract_type: "call" },
                implied_volatility: 0.30,
                underlying_asset: { price: 100 },
              },
            ],
            next_url: "https://api.massive.com/v3/snapshot/options/NVDA?cursor=PAGE2",
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          results: [
            {
              details: { strike_price: 100, expiration_date: "2026-06-19", contract_type: "call" },
              implied_volatility: 0.34,
            },
          ],
        }),
        { status: 200 },
      );
    });

    const { contracts } = await fetchOptionChainSnapshot("NVDA");
    expect(call).toBe(2);
    expect(contracts.map((c) => c.expiry)).toEqual(["2026-05-15", "2026-06-19"]);
  });

  it("refuses to follow an off-host next_url (does not leak the token)", async () => {
    let call = 0;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      // Page 1 (on api.massive.com) points pagination at an attacker host.
      return new Response(
        JSON.stringify({
          results: [
            {
              details: { strike_price: 100, expiration_date: "2026-05-15", contract_type: "call" },
              implied_volatility: 0.3,
            },
          ],
          next_url: "https://evil.example.com/v3/snapshot/options/NVDA?cursor=PWNED",
        }),
        { status: 200 },
      );
    });

    await expect(fetchOptionChainSnapshot("NVDA")).rejects.toThrow(/unexpected host/);
    // Only the first (allowed-host) page was fetched; the off-host URL was never hit.
    expect(call).toBe(1);
    spy.mockRestore();
  });

  it("returns an empty contract list for an empty-but-successful chain", async () => {
    mockFetchByUrl([{ match: "/v3/snapshot/options/", payload: { results: [] } }]);
    const { spot, contracts } = await fetchOptionChainSnapshot("ZZZZ");
    expect(contracts).toEqual([]);
    expect(spot).toBeNull();
  });

  it("throws on a non-2xx response", async () => {
    mockFetchByUrl([{ match: "/v3/snapshot/options/", payload: { error: "nope" } }], 403);
    await expect(fetchOptionChainSnapshot("NVDA")).rejects.toThrow(/Massive/);
  });
});

describe("fetchFuturesFrontNext", () => {
  it("resolves front + next and reads their session closes", async () => {
    mockFetchByUrl([
      { match: "/v3/futures/contracts", payload: { results: [{ ticker: "ESM6" }, { ticker: "ESU6" }] } },
      { match: "/v3/futures/aggregates/ESM6", payload: { results: [{ close: 5612.5 }, { close: 5646.0 }] } },
      { match: "/v3/futures/aggregates/ESU6", payload: { results: [{ close: 5636.0 }, { close: 5660.0 }] } },
    ]);
    const { front, next } = await fetchFuturesFrontNext("ES");
    expect(front).toEqual({ ticker: "ESM6", last: 5612.5, priorClose: 5646.0 });
    expect(next).toMatchObject({ ticker: "ESU6", last: 5636.0 });
  });

  it("returns nulls when the product has no active contracts", async () => {
    mockFetchByUrl([{ match: "/v3/futures/contracts", payload: { results: [] } }]);
    const out = await fetchFuturesFrontNext("ES");
    expect(out).toEqual({ front: null, next: null });
  });

  it("preserves the front leg when the next contract's aggregates fail", async () => {
    // Regression: a failed aggregates fetch for the SECOND contract must not
    // throw away the front leg that already priced (would null the whole
    // product's front-month price + session change downstream).
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const url = String(input instanceof URL ? input.href : input);
      if (url.includes("/v3/futures/contracts")) {
        return new Response(JSON.stringify({ results: [{ ticker: "ESM6" }, { ticker: "ESU6" }] }), {
          status: 200,
        });
      }
      if (url.includes("/v3/futures/aggregates/ESM6")) {
        return new Response(JSON.stringify({ results: [{ close: 5612.5 }, { close: 5646.0 }] }), {
          status: 200,
        });
      }
      // The next contract's aggregates fail.
      return new Response("error", { status: 500 });
    });

    const { front, next } = await fetchFuturesFrontNext("ES");
    expect(front).toEqual({ ticker: "ESM6", last: 5612.5, priorClose: 5646.0 });
    expect(next).toBeNull();
  });

  it("leaves priorClose null when only one bar is returned", async () => {
    mockFetchByUrl([
      { match: "/v3/futures/contracts", payload: { results: [{ ticker: "CLM6" }] } },
      { match: "/v3/futures/aggregates/CLM6", payload: { results: [{ close: 78.9 }] } },
    ]);
    const { front, next } = await fetchFuturesFrontNext("CL");
    expect(front).toEqual({ ticker: "CLM6", last: 78.9, priorClose: null });
    expect(next).toBeNull();
  });

  it("throws on a non-2xx contracts response", async () => {
    mockFetchByUrl([{ match: "/v3/futures/contracts", payload: {} }], 500);
    await expect(fetchFuturesFrontNext("ES")).rejects.toThrow(/Massive/);
  });
});
