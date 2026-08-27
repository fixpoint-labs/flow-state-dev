/**
 * Unit tests for the TraderProposalCard's pure rules (FIX-1061).
 *
 * The test env is node + `.spec.ts` (no JSX rendering), so — matching the
 * `lens-card.spec.ts` / `aggregate.ts` precedent — every rule with an honesty
 * consequence lives in an exported pure helper and is asserted directly.
 *
 * These are INTENT-ENCODING tests. Each one locks a real-money rule, and each
 * is built so it would FAIL on the broken version:
 *
 *  - the card authors no price-level name (a hard-coded "stop" fails);
 *  - the labeling rule is called with `direction`, not `stance` (asserted with
 *    a memo carrying BOTH, differing — with matching values the mix-up is
 *    invisible, because it type-checks and most memos have a null `stance`);
 *  - a legacy flat record's two numbers reach the reader ONCE, captioned and
 *    unnamed — the property that lets the metrics row drop its level keys
 *    without a legacy reader losing sight of the numbers entirely;
 *  - a stored `metrics` bag's level keys never render beside the trade line
 *    (built as a PERSISTED-state case, since the post-FIX-780 schema cannot
 *    produce those keys — a test built from the schema would pass on the
 *    broken code);
 *  - the free-form copies of the typed legs are dropped, asserted with values
 *    that DISAGREE with the typed fields (with matching values a broken filter
 *    looks identical to a working one);
 *  - an unrecognized metric key survives — the denylist property. A test that
 *    only checks the known keys are dropped passes on an allowlist, which is
 *    the implementation this card rejects;
 *  - the stance renders once. `rating` and `direction` are separate enums on
 *    the trader's output and nothing forces them to agree, so this is asserted
 *    on a memo where they contradict.
 */
import { describe, expect, it } from "vitest";
import {
  traderHeaderModel,
  traderTradeLine,
  type TraderMemoData,
} from "../components/theses/trader-proposal-card";

/** A trader memo as the writer commits it. Level fields are spread rather than
 *  defaulted, so a case can omit a key entirely — which is the shape a record
 *  written before FIX-780 actually has (BP-030: missing key ≠ explicit null). */
function traderMemo(overrides: Partial<TraderMemoData> = {}): TraderMemoData {
  return {
    label: "Trade proposal",
    headline: "Constructive entry on the pullback",
    metrics: null,
    body: null,
    citations: null,
    direction: "long",
    sizePct: 1.4,
    holdingPeriod: "months",
    invalidationCriteria: null,
    dependsOn: null,
    ...overrides,
  };
}

describe("the trade one-liner is delegated, never authored here", () => {
  it("names a directional run's levels with the shared rule's own words", () => {
    const line = traderTradeLine(
      traderMemo({ direction: "long", stopPrice: 132, targetPrice: 185 }),
    );
    expect(line).toEqual(["LONG", "1.4% NAV", "stop 132", "target 185", "months"]);
  });

  it("names a flat run's monitoring levels — and never as a stop or a target", () => {
    const line = traderTradeLine(
      traderMemo({
        direction: "flat",
        sizePct: 0,
        reassessBelowPrice: 195,
        invalidateAbovePrice: 320,
      }),
    );
    expect(line).toEqual([
      "FLAT",
      "0% NAV",
      "reassess below 195",
      "invalidate above 320",
      "months",
    ]);
    // A stand-aside call has no position to stop out of. If this renderer ever
    // spells a level name itself, these words appear on a flat run.
    expect(line.join(" ")).not.toMatch(/\bstop\b|\btarget\b/);
  });

  it("shows a LEGACY flat record's pair once, captioned and unnamed", () => {
    // The pre-FIX-780 shape: a flat call that stored the trade pair and has no
    // monitoring keys at all. This is the property that lets the metrics row
    // drop its level keys — the structured line is where a legacy reader sees
    // these two numbers, so if this assertion ever fails, stripping the metrics
    // row would delete them from the screen entirely.
    const line = traderTradeLine(
      traderMemo({
        direction: "flat",
        sizePct: 0,
        stopPrice: 320,
        targetPrice: 195,
      }),
    );
    expect(line).toEqual(["FLAT", "0% NAV", "levels recorded: 195, 320", "months"]);
    // Once — one segment for the pair, not one per number.
    expect(line.filter((p) => p.includes("195"))).toHaveLength(1);
    // Neither number is named, and neither is suppressed.
    expect(line.join(" ")).not.toMatch(/\bstop\b|\btarget\b/);
    expect(line.join(" ")).toContain("320");
  });

  it("follows `direction`, not the research manager's `stance`", () => {
    // `stance` is the Phase-2 research manager's verdict and is null on a
    // trader memo; passing it to the level rule still compiles and silently
    // yields no levels. A memo carrying both, differing, is what makes the
    // mix-up visible.
    const line = traderTradeLine({
      ...traderMemo({
        direction: "flat",
        sizePct: 0,
        reassessBelowPrice: 195,
        invalidateAbovePrice: 320,
      }),
      // A non-null `stance` that disagrees with `direction`.
      ...({ stance: "bullish" } as Partial<TraderMemoData>),
    });
    expect(line).toContain("reassess below 195");
    expect(line[0]).toBe("FLAT");
  });

  it("contributes no segment for a leg the trader did not publish", () => {
    const line = traderTradeLine(
      traderMemo({ direction: null, sizePct: null, holdingPeriod: null }),
    );
    // No levels, no legs — an empty line, never a row of dashes.
    expect(line).toEqual([]);
  });
});

describe("the metrics row drops what the structured line already draws", () => {
  it("renders no level cells for a record persisted before the labeling fix", () => {
    // The legacy bag. Against the post-FIX-780 schema these keys cannot occur,
    // so this HAS to be written as a persisted-state case: a test built from
    // the schema would pass on the broken code.
    const model = traderHeaderModel(
      traderMemo({
        direction: "flat",
        sizePct: 0,
        stopPrice: 320,
        targetPrice: 195,
        metrics: {
          direction: "flat",
          size: "0%",
          stop: "$320",
          target: "$195",
          conviction: "medium",
        },
      }),
    );
    expect(model.metrics).toEqual({ conviction: "medium" });
    // The levels have exactly one owner on this card, and it is the trade line.
    expect(JSON.stringify(model.metrics)).not.toMatch(/stop|target|320|195/);
  });

  it("keeps the typed legs and drops the free-form copies that disagree", () => {
    // The disagreement is what makes this test able to fail: with matching
    // values a broken filter looks identical to a working one.
    const memo = traderMemo({
      direction: "long",
      sizePct: 1.4,
      holdingPeriod: "months",
      stopPrice: 132,
      metrics: {
        direction: "short",
        size: "9% NAV",
        holdingPeriod: "days",
        conviction: "high",
      },
    });
    const model = traderHeaderModel(memo);
    const line = traderTradeLine(memo);

    expect(model.metrics).toEqual({ conviction: "high" });
    // Only the typed values reach the reader, and only once.
    expect(line).toContain("LONG");
    expect(line).toContain("1.4% NAV");
    expect(JSON.stringify(model.metrics)).not.toContain("short");
    expect(JSON.stringify(model.metrics)).not.toContain("9% NAV");
  });

  it("lets a metric nobody anticipated through — the denylist property", () => {
    // The whole defect this issue fixes is a stored field that never reaches
    // the screen. An allowlist of today's keys would rebuild it inside the fix,
    // and would pass every other test in this block.
    const model = traderHeaderModel(
      traderMemo({
        metrics: {
          direction: "long",
          conviction: "high",
          borrowCost: "0.4%",
        },
      }),
    );
    expect(model.metrics).toEqual({ conviction: "high", borrowCost: "0.4%" });
  });

  it("renders no grid at all when nothing survives the filter", () => {
    const model = traderHeaderModel(
      traderMemo({ metrics: { direction: "long", size: "1.4% NAV" } }),
    );
    // Null, not `{}` — an empty grid is chrome asserting the desk measured
    // something it did not.
    expect(model.metrics).toBeNull();
  });

  it("survives a memo with no metrics bag at all", () => {
    expect(traderHeaderModel(traderMemo({ metrics: null })).metrics).toBeNull();
    expect(traderHeaderModel(null).metrics).toBeNull();
  });
});

describe("the stance renders once", () => {
  it("suppresses the header's rating chip, so a disagreeing pair cannot both show", () => {
    // `rating` and `direction` are two separate `long | short | flat` enums on
    // the trader's output schema and the commit handler enforces no equality
    // between them. `direction` is canonical here — it is the field the levels
    // were named from.
    const memo = {
      ...traderMemo({ direction: "long", stopPrice: 132 }),
      ...({ rating: "short" } as Partial<TraderMemoData>),
    };
    const model = traderHeaderModel(memo);
    const line = traderTradeLine(memo);

    expect(model.rating).toBeNull();
    expect(line[0]).toBe("LONG");
    // Exactly one stance token reaches the reader, from the typed field.
    const rendered = [...line, JSON.stringify(model.metrics)].join(" ");
    expect(rendered.toLowerCase()).not.toContain("short");
  });
});
