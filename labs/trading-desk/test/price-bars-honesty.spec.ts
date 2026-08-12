/**
 * OHLCV price bars — an incomplete bar is dropped, never zero-filled (FIX-1063).
 *
 * This is the fourth producer class ("sparse-but-successful adapters") on the
 * path the honesty stamp certifies, and it was the one still fabricating. Both
 * chart adapters accepted a SUCCESSFUL response and defaulted missing legs to
 * `0`, so a bar with a real open and close published a low of zero and a
 * zero-volume day under a live provider tag — into persisted price history, the
 * technical indicators (ATR, the stochastic oscillator, OBV, VWMA), and the
 * short-interest volume filter. Nothing marked the gap, because nothing failed.
 *
 * Why DROP rather than widen the bar to nullable legs: the bar is the unit of
 * observation. Every OHLC consumer needs the whole tuple, so a partial bar has
 * no honest reading to offer them, and the Yahoo adapter already dropped bars
 * missing `open`/`close` — this extends that same rule to the full tuple and to
 * both providers, rather than introducing a second policy.
 *
 * The measured-zero direction is pinned too. A genuine zero-volume session (a
 * halted or untraded name) is a reading, and dropping it would be the mirror
 * defect: deleting evidence the desk actually gathered.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { chartMock } = vi.hoisted(() => ({ chartMock: vi.fn() }));

vi.mock("yahoo-finance2", () => ({
  default: class {
    chart = chartMock;
  },
}));

import { fetchYahooChart } from "../lib/providers/yahoo";
import { fetchFinnhubCandles } from "../lib/providers/finnhub";

const INPUT = { ticker: "NVDA", date: "2026-05-06", range: "1mo" } as const;

/** A complete Yahoo quote — the control every case below varies one leg of. */
function completeQuote(date: string, close: number) {
  return {
    date: new Date(`${date}T00:00:00Z`),
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1_000_000,
  };
}

afterEach(() => {
  chartMock.mockReset();
  vi.restoreAllMocks();
});

describe("fetchYahooChart — a successful response carrying a sparse bar", () => {
  it("drops a bar missing high/low rather than publishing a zero low", async () => {
    // The exact shape the review named: `open`/`close` present, the rest gone.
    // The old mapping wrote `high: 0, low: 0`, which is a bar claiming the
    // stock traded at zero.
    chartMock.mockResolvedValue({
      quotes: [
        completeQuote("2026-05-05", 100),
        { date: new Date("2026-05-06T00:00:00Z"), open: 101, close: 103 },
      ],
    });

    const out = await fetchYahooChart(INPUT);

    expect(out.source).toBe("yahoo");
    expect(out.bars).toHaveLength(1);
    expect(out.bars[0].date).toBe("2026-05-05");
    // Nothing anywhere in the series claims a zero price or a zero volume.
    for (const bar of out.bars) {
      expect(bar.high).toBeGreaterThan(0);
      expect(bar.low).toBeGreaterThan(0);
    }
  });

  it("drops a bar missing only volume", async () => {
    // Volume is the leg most easily dismissed as harmless. It is not: it feeds
    // OBV, VWMA, and the short-interest average-volume filter, all of which
    // read a fabricated 0 as "nothing traded".
    chartMock.mockResolvedValue({
      quotes: [
        completeQuote("2026-05-05", 100),
        { ...completeQuote("2026-05-06", 103), volume: undefined },
      ],
    });

    const out = await fetchYahooChart(INPUT);

    expect(out.bars).toHaveLength(1);
    expect(out.bars[0].date).toBe("2026-05-05");
  });

  it("KEEPS a genuine zero-volume bar — that is a measurement, not a gap", async () => {
    // The mirror direction. A halted or untraded session really did trade zero
    // shares; dropping it would delete a reading the desk took.
    chartMock.mockResolvedValue({
      quotes: [{ ...completeQuote("2026-05-05", 100), volume: 0 }],
    });

    const out = await fetchYahooChart(INPUT);

    expect(out.bars).toHaveLength(1);
    expect(out.bars[0].volume).toBe(0);
  });

  it("drops a bar with an unreadable date instead of throwing away the fetch", async () => {
    // The bar can't be placed in a series without a date. It must DROP rather
    // than throw: `toISOString()` on an Invalid Date raises a RangeError, which
    // would turn one malformed timestamp into a total price-history outage —
    // trading a fabricated bar for a fabricated provider failure.
    chartMock.mockResolvedValue({
      quotes: [
        completeQuote("2026-05-05", 100),
        { ...completeQuote("2026-05-06", 103), date: new Date("not-a-date") },
      ],
    });

    const out = await fetchYahooChart(INPUT);

    expect(out.bars).toHaveLength(1);
    expect(out.bars[0].date).toBe("2026-05-05");
  });

  it("keeps a complete series untouched", async () => {
    chartMock.mockResolvedValue({
      quotes: [completeQuote("2026-05-05", 100), completeQuote("2026-05-06", 103)],
    });

    const out = await fetchYahooChart(INPUT);

    expect(out.bars).toHaveLength(2);
    expect(out.bars.map((b) => b.close)).toEqual([100, 103]);
  });
});

describe("fetchFinnhubCandles — misaligned parallel arrays", () => {
  beforeAll(() => {
    process.env.FINNHUB_API_KEY = "test-key";
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockCandles(payload: unknown) {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(payload), { status: 200 }),
    );
  }

  it("drops bars whose OHLCV arrays ran short instead of inventing a zero CLOSE", async () => {
    // Finnhub returns OHLCV as five PARALLEL arrays. A short array indexed past
    // its end used to yield `close: 0` — worse than dishonest: a zero close
    // enters persisted price history and divides through `trailingReturn`.
    // Note this adapter had NO open/close filter at all, so nothing caught it.
    mockCandles({
      s: "ok",
      t: [1_746_316_800, 1_746_403_200, 1_746_489_600],
      o: [100, 101, 102],
      h: [104, 105, 106],
      l: [99, 100, 101],
      c: [103, 104], // one short
      v: [1_000, 1_100, 1_200],
    });

    const out = await fetchFinnhubCandles(INPUT);

    expect(out.source).toBe("finnhub");
    expect(out.bars).toHaveLength(2);
    // The dropped third bar is simply absent — no zero-close bar survives.
    expect(out.bars.every((b) => b.close > 0)).toBe(true);
  });

  it("KEEPS a genuine zero-volume bar", async () => {
    mockCandles({
      s: "ok",
      t: [1_746_316_800],
      o: [100],
      h: [104],
      l: [99],
      c: [103],
      v: [0],
    });

    const out = await fetchFinnhubCandles(INPUT);

    expect(out.bars).toHaveLength(1);
    expect(out.bars[0].volume).toBe(0);
  });

  it("keeps a fully aligned series untouched", async () => {
    mockCandles({
      s: "ok",
      t: [1_746_316_800, 1_746_403_200],
      o: [100, 101],
      h: [104, 105],
      l: [99, 100],
      c: [103, 104],
      v: [1_000, 1_100],
    });

    const out = await fetchFinnhubCandles(INPUT);

    expect(out.bars).toHaveLength(2);
    expect(out.bars.map((b) => b.close)).toEqual([103, 104]);
  });
});
