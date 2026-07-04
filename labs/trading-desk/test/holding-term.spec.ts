/**
 * Term-classification math (`components/portfolio/holding-term.ts`).
 *
 * Intent encoded: the IRS long-term boundary is EXCLUSIVE — a lot sold exactly
 * one year after acquisition is still short-term — and classification is per
 * LOT, so a position bought across dates reports the honest mixed split
 * instead of inheriting its earliest lot's term. Undated shares are surfaced
 * as unknown, never guessed into a term.
 */
import { describe, expect, it } from "vitest";
import {
  computeHoldingTerm,
  formatTerm,
  type TermLot,
} from "../components/portfolio/holding-term";

const lot = (quantity: number, acquiredDate: string | null): TermLot => ({
  quantity,
  acquiredDate,
});

// Fixed "today" so the specs never rot: 2026-07-04 UTC.
const ASOF = new Date(Date.UTC(2026, 6, 4));

describe("computeHoldingTerm", () => {
  it("treats the one-year anniversary as still short (exclusive boundary)", () => {
    // Acquired exactly one year ago — long only AFTER the anniversary day.
    const onAnniversary = computeHoldingTerm([lot(10, "2025-07-04")], ASOF);
    expect(onAnniversary.shortQty).toBe(10);
    expect(onAnniversary.longQty).toBe(0);

    const dayPast = computeHoldingTerm([lot(10, "2025-07-03")], ASOF);
    expect(dayPast.longQty).toBe(10);
    expect(dayPast.shortQty).toBe(0);
    expect(dayPast.monthsToAllLong).toBeNull();
  });

  it("splits mixed lots per lot and counts months until the LAST short lot turns long", () => {
    const term = computeHoldingTerm(
      [
        lot(60, "2024-01-10"), // long
        lot(30, "2026-01-04"), // short — long on 2027-01-04 (~6 mo)
        lot(10, "2026-04-04"), // short — long on 2027-04-04 (~9 mo, governs)
      ],
      ASOF,
    );
    expect(term.longQty).toBe(60);
    expect(term.shortQty).toBe(40);
    expect(term.monthsToAllLong).toBe(9);
  });

  it("rounds a nearly-long lot up to 1 month, never 0", () => {
    const term = computeHoldingTerm([lot(5, "2025-07-05")], ASOF); // long tomorrow
    expect(term.shortQty).toBe(5);
    expect(term.monthsToAllLong).toBe(1);
  });

  it("counts undated shares as unknown, not into either term", () => {
    const term = computeHoldingTerm([lot(10, "2024-01-01"), lot(4, null)], ASOF);
    expect(term.longQty).toBe(10);
    expect(term.unknownQty).toBe(4);
    expect(term.shortQty).toBe(0);
  });
});

describe("formatTerm", () => {
  const asOf = ASOF;
  it("renders the four shapes: long, short-with-countdown, mixed, unknown", () => {
    expect(formatTerm(computeHoldingTerm([lot(10, "2024-01-01")], asOf))).toBe("Long");
    expect(formatTerm(computeHoldingTerm([lot(10, "2026-04-04")], asOf))).toBe(
      "Short · 9 mo to long",
    );
    expect(
      formatTerm(
        computeHoldingTerm([lot(60, "2024-01-10"), lot(40, "2026-04-04")], asOf),
      ),
    ).toBe("60L / 40S · 9 mo");
    expect(formatTerm(computeHoldingTerm([lot(10, null)], asOf))).toBe("—");
  });

  it("surfaces undated shares beside a dated term instead of hiding them", () => {
    expect(
      formatTerm(computeHoldingTerm([lot(10, "2024-01-01"), lot(4, null)], asOf)),
    ).toBe("Long · 4 undated");
  });
});
