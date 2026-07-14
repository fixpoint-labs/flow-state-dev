/**
 * Unit tests for the 8-K item-code classifier (FIX-708).
 * Pure module — no IO, no mocks needed.
 */
import { describe, expect, it } from "vitest";
import { classifyItems } from "../src/providers/eight-k-items";

describe("classifyItems", () => {
  it("maps a known high-signal code to the correct label/title/signal", () => {
    const result = classifyItems("2.02");
    expect(result).toEqual([
      { code: "2.02", label: "earnings", title: "Results of Operations and Financial Condition", signal: "high" },
    ]);
  });

  it("splits multi-code string and classifies each code", () => {
    const result = classifyItems("2.02,9.01");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ code: "2.02", label: "earnings", signal: "high" });
    expect(result[1]).toMatchObject({ code: "9.01", label: "exhibits", signal: "low" });
  });

  it("maps leadership change (5.02) as high signal", () => {
    const result = classifyItems("5.02");
    expect(result).toEqual([
      { code: "5.02", label: "leadership-change", title: expect.any(String), signal: "high" },
    ]);
  });

  it("handles three-code filing with mixed signals", () => {
    const result = classifyItems("5.02,5.03,9.01");
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ signal: "high" });
    expect(result[1]).toMatchObject({ signal: "low" });
    expect(result[2]).toMatchObject({ signal: "low" });
  });

  it("returns other/low for unknown future item code", () => {
    const result = classifyItems("X.YY");
    expect(result).toEqual([
      { code: "X.YY", label: "other", title: "Other event", signal: "low" },
    ]);
  });

  it("returns other/low for legacy dotless code", () => {
    const result = classifyItems("2");
    expect(result).toEqual([
      { code: "2", label: "other", title: "Other event", signal: "low" },
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(classifyItems("")).toEqual([]);
  });

  it("classifies medium-signal codes correctly", () => {
    const result = classifyItems("7.01");
    expect(result).toEqual([
      { code: "7.01", label: "reg-fd", title: "Regulation FD Disclosure", signal: "medium" },
    ]);
  });
});
