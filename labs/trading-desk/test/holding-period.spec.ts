/**
 * Unit tests for the IRS short/long-term boundary (`holding-period.ts`, FIX-874).
 *
 * Intent encoded: the boundary is calendar-anniversary-based and EXCLUSIVE — a
 * lot sold on the day exactly one year after acquisition is still short-term;
 * long-term begins the day AFTER. A null acquisition date is honestly "unknown",
 * never guessed into a term.
 */
import { describe, expect, it } from "vitest";
import { classifyTerm } from "@/src/domain/portfolio/math/holding-period";

describe("classifyTerm", () => {
  it("is short on the one-year anniversary day itself (boundary exclusive)", () => {
    expect(classifyTerm("2025-03-10", "2026-03-10")).toBe("short");
  });

  it("is long the day after the anniversary", () => {
    expect(classifyTerm("2025-03-10", "2026-03-11")).toBe("long");
  });

  it("is short well within a year", () => {
    expect(classifyTerm("2026-01-01", "2026-06-30")).toBe("short");
  });

  it("is long for a multi-year hold", () => {
    expect(classifyTerm("2020-01-01", "2026-01-01")).toBe("long");
  });

  it("handles a leap-day acquisition by calendar arithmetic, not day count", () => {
    // 2024-02-29 + 1 year = 2025-02-29 → normalizes to 2025-03-01 boundary.
    // A day-count (>=365) rule would flip a day early; the calendar rule doesn't.
    expect(classifyTerm("2024-02-29", "2025-02-28")).toBe("short");
    expect(classifyTerm("2024-02-29", "2025-03-01")).toBe("short");
    expect(classifyTerm("2024-02-29", "2025-03-02")).toBe("long");
  });

  it("returns unknown when the acquisition date is null", () => {
    expect(classifyTerm(null, "2026-03-10")).toBe("unknown");
  });
});
