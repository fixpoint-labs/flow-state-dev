/**
 * Tests for `flows/analysis/flow-schema.ts`'s BP-030 tolerance on the
 * persisted `portfolioContextInput` shape (specifically its nested
 * `health.lookThrough` field, FIX-801 sub-PR c round 42).
 *
 * `portfolioContextInput` backs `sessionStateSchema.portfolio`
 * (`flows/analysis/state.ts:85`) — a durable session checkpoint field, not a
 * generator output, so `.nullable()`/`.default()` are the right tools (per
 * this file's own header comment). `health` (the FIX-762 aggregate) already
 * predates this PR and is safely defaulted; `lookThrough` is a NEW field this
 * PR added to that already-persisted object. A session interrupted before
 * this PR deploys can be resumed after deploy against a `health` object that
 * has every OTHER field but genuinely no `lookThrough` KEY at all — a
 * different failure mode than an explicit `null` value, which `.nullable()`
 * alone does not cover. Per `packages/core/src/blocks/sequencer.ts`'s
 * checkpoint-validation gate, a failed parse means the durable write is
 * skipped, so a session interrupted a second time after a failed resume
 * can't recover either.
 */
import { describe, expect, it } from "vitest";
import { portfolioContextInput } from "../flows/analysis/flow-schema";

/** A `portfolioContextInput`-shaped object whose `health` block carries every
 *  field the pre-look-through (FIX-762) shape had, with `lookThrough` NOT
 *  spread in unless the caller supplies it via `healthOverrides` — the exact
 *  old-checkpoint shape this PR must still tolerate. */
function legacyContext(healthOverrides: Record<string, unknown> = {}) {
  return {
    totalNav: 10_000,
    snapshotAsOf: "2026-05-06",
    pricedHoldings: 1,
    totalHoldings: 1,
    accounts: [],
    holdings: [],
    health: {
      cashPct: 10,
      coveragePct: 100,
      assetClassAllocation: [],
      sectorExposure: [],
      concentration: { maxPosition: null, top5Pct: null, effectivePositions: null, flags: [] },
      drift: null,
      ...healthOverrides,
    },
  };
}

describe("portfolioContextInput — BP-030 tolerance for the pre-look-through health shape", () => {
  it("parses a legacy health object with the lookThrough key entirely absent, defaulting it to null", () => {
    const legacy = legacyContext();
    expect("lookThrough" in legacy.health).toBe(false); // sanity: genuinely absent, not an explicit null

    const parsed = portfolioContextInput.parse(legacy);
    expect(parsed.health?.lookThrough).toBeNull();
  });

  it("still accepts an explicit null lookThrough (the current post-deploy shape when nothing was attributed)", () => {
    const parsed = portfolioContextInput.parse(legacyContext({ lookThrough: null }));
    expect(parsed.health?.lookThrough).toBeNull();
  });
});
