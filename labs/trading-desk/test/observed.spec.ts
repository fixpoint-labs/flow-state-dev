/**
 * The shared absence-aware coercion leaf (FIX-1063).
 *
 * This leaf exists so Yahoo and Finnhub cannot diverge on what counts as an
 * observation. That consolidation makes the rule CONSISTENT, not correct — a
 * defect here fabricates in both adapters at once, which is why the leaf's own
 * unit coverage is finer-grained than either adapter's.
 *
 * The case that motivated this file: `observedFinite` used to fall through to
 * `Number(raw)`, and `Number("")`, `Number("   ")` and `Number(false)` are all
 * a finite `0`. A blank provider field therefore read as an observed zero, and
 * `isObservedBar` accepted the bar — recreating the fabricated zero price and
 * zero-volume day the helper was introduced to prevent.
 */
import { describe, expect, it } from "vitest";
import { isObservedBar, observedFinite, observedIsoDay } from "../lib/providers/observed";

describe("observedFinite — a non-numeric primitive is not an observation", () => {
  // The three shapes JS coercion silently turns into a finite 0. Each one is a
  // provider NOT answering, so each must read null.
  it.each([
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
    ["a tab/newline string", "\t\n"],
    ["boolean false", false],
    ["boolean true", true],
    ["an empty array", []],
  ])("reads %s as unobserved", (_label, value) => {
    expect(observedFinite(value)).toBeNull();
  });

  it("reads a numeric STRING as unobserved rather than parsing it", () => {
    // Deliberate: the adapters on this leaf hand it numbers or Yahoo's { raw }
    // envelope. Alpha Vantage is the string-typed provider and parses its own
    // with num(). A string here is an unmodelled shape, and under-claiming is
    // the contract's required direction.
    expect(observedFinite("123.45")).toBeNull();
    expect(observedFinite("0")).toBeNull();
  });

  it("reads absent and non-finite values as unobserved", () => {
    expect(observedFinite(undefined)).toBeNull();
    expect(observedFinite(null)).toBeNull();
    expect(observedFinite(NaN)).toBeNull();
    expect(observedFinite(Infinity)).toBeNull();
    expect(observedFinite(-Infinity)).toBeNull();
  });

  it("KEEPS a finite zero — that is a measurement, not a gap", () => {
    // The over-application guard. The axis under test is observed vs
    // unobserved, holding the value at 0 fixed.
    expect(observedFinite(0)).toBe(0);
    expect(observedFinite({ raw: 0 })).toBe(0);
  });

  it("reads a finite number, and unwraps Yahoo's { raw } envelope", () => {
    expect(observedFinite(12.5)).toBe(12.5);
    expect(observedFinite({ raw: 12.5, fmt: "12.50" })).toBe(12.5);
  });

  it("rejects a { raw } envelope whose payload is not a finite number", () => {
    expect(observedFinite({ raw: "" })).toBeNull();
    expect(observedFinite({ raw: "12.5" })).toBeNull();
    expect(observedFinite({ raw: NaN })).toBeNull();
    expect(observedFinite({ fmt: "12.50" })).toBeNull();
  });
});

describe("isObservedBar — a blank leg cannot pass as a complete bar", () => {
  const complete = {
    date: "2026-05-06",
    open: 100,
    high: 102,
    low: 98,
    close: 101,
    volume: 1_000_000,
  };

  it("rejects a bar whose leg came from a blank provider field", () => {
    // The end-to-end shape of the defect: a blank `low` coerced to 0, and the
    // bar then claimed the stock traded down to nothing.
    const bar = { ...complete, low: observedFinite("") };
    expect(bar.low).toBeNull();
    expect(isObservedBar(bar)).toBe(false);
  });

  it("rejects a bar whose volume came from a boolean", () => {
    const bar = { ...complete, volume: observedFinite(false) };
    expect(bar.volume).toBeNull();
    expect(isObservedBar(bar)).toBe(false);
  });

  it("KEEPS a bar with a genuine zero-volume session", () => {
    // A halted or untraded name is a reading. Dropping it would be the mirror
    // defect — deleting evidence the desk actually gathered.
    expect(isObservedBar({ ...complete, volume: observedFinite(0) })).toBe(true);
  });

  it("keeps a fully observed bar", () => {
    expect(isObservedBar(complete)).toBe(true);
  });
});

describe("observedIsoDay", () => {
  it("reads an unusable timestamp as null rather than throwing", () => {
    // toISOString() on an Invalid Date raises a RangeError, which would turn
    // one malformed timestamp into a total price-history outage.
    expect(observedIsoDay("not-a-date")).toBeNull();
    expect(observedIsoDay(undefined)).toBeNull();
    expect(() => observedIsoDay("not-a-date")).not.toThrow();
  });

  it("reads a Date and an epoch-millis number as an ISO day", () => {
    expect(observedIsoDay(new Date("2026-05-06T00:00:00Z"))).toBe("2026-05-06");
    expect(observedIsoDay(Date.UTC(2026, 4, 6))).toBe("2026-05-06");
  });

  // The DATE-axis twin of the `Number("") === 0` defect above, and the reason
  // it survived: this leaf was hardened against coercion on the numeric axis
  // one function away, which drew the eye off its neighbour. `new Date` coerces
  // too — `new Date(null)` and `new Date(false)` are a perfectly valid
  // 1970-01-01 — so a quote with an absent timestamp yielded an epoch-dated
  // bar, `isObservedBar` kept it, and a fabricated historical bar entered
  // persisted price history and the indicator windows.
  it.each([
    ["null", null],
    ["boolean false", false],
    ["boolean true", true],
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
    ["an empty array", []],
    ["an empty object", {}],
    ["NaN", NaN],
  ])("reads %s as unobserved, never as the epoch", (_label, value) => {
    expect(observedIsoDay(value)).toBeNull();
  });

  it("does not date a bar to 1970 from an absent timestamp", () => {
    // Stated as the outcome rather than the input, because the outcome is what
    // made this dangerous: the bar passed `isObservedBar` and shipped.
    for (const absent of [null, false, undefined]) {
      const bar = {
        date: observedIsoDay(absent),
        open: 100,
        high: 102,
        low: 98,
        close: 101,
        volume: 1_000_000,
      };
      expect(bar.date).not.toBe("1970-01-01");
      expect(isObservedBar(bar)).toBe(false);
    }
  });

  it("KEEPS epoch 0 handed over as a real numeric timestamp", () => {
    // The over-application guard, matching `observedFinite`'s finite-zero rule:
    // the axis under test is observed vs unobserved, not zero vs non-zero. A
    // provider that genuinely answered `0` answered.
    expect(observedIsoDay(0)).toBe("1970-01-01");
  });
});
