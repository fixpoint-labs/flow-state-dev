/**
 * Shared holding-period boundary math (`src/flows/portfolio/holding-period.ts`).
 *
 * Intent encoded: the IRS long-term boundary is EXCLUSIVE — a lot disposed
 * exactly one year after acquisition is still short-term — and it is
 * calendar-anniversary based (not a 365-day count), so a leap-year
 * acquisition still lands on a sane boundary.
 */
import { describe, expect, it } from "vitest";
import { classifyTerm } from "../src/flows/portfolio/holding-period";

describe("classifyTerm", () => {
  it("treats the one-year anniversary as still short (exclusive boundary)", () => {
    expect(classifyTerm("2024-03-15", "2025-03-15")).toBe("short");
  });

  it("becomes long the day after the anniversary", () => {
    expect(classifyTerm("2024-03-15", "2025-03-16")).toBe("long");
  });

  it("reads unknown for a null acquiredDate, never guessed into a term", () => {
    expect(classifyTerm(null, "2025-03-16")).toBe("unknown");
  });

  it("handles a leap-year acquisition via calendar (not day-count) math", () => {
    // 2024-02-29 + 1 calendar year = 2025-03-01 (JS Date normalizes the
    // nonexistent 2025-02-29) — that lands the boundary itself, so disposing
    // ON 2025-03-01 is still short (exclusive boundary); the day after it
    // is the first long day.
    expect(classifyTerm("2024-02-29", "2025-02-28")).toBe("short");
    expect(classifyTerm("2024-02-29", "2025-03-01")).toBe("short");
    expect(classifyTerm("2024-02-29", "2025-03-02")).toBe("long");
  });
});
