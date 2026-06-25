/**
 * Cross-method valuation triangulation.
 *
 * The spine carries two intrinsic-value methods that abstain on DIFFERENT
 * cohorts: justified-PE (abstains on high-growth names) and DCF (abstains on
 * financials / negative-FCF). This consolidates their available margin-of-safety
 * readings into a single consensus and classifies their agreement:
 *
 *   - 0 readings → `unavailable`, consensus null.
 *   - 1 reading  → `single-method`, consensus = that reading.
 *   - 2 readings → consensus = mean; `convergent` when the spread is within the
 *     divergence threshold, else `divergent` (the divergence is itself signal —
 *     surfaced to the PM, not resolved mechanically).
 *
 * Consumed by the setup score's value sub-score (the consensus MoS) and the PM's
 * margin-of-safety reasoning (the divergence classification). Does NOT bind the
 * absolute Buy gate — that stays anchored to justified-PE (FIX-807 Open Q1:
 * soft-only, to preserve FIX-778's return-anchored Buy for high-growth names).
 */
import type { FairValue } from "./fair-value";
import type { DcfValue } from "./dcf";

/** Spread in margin-of-safety points (25pp) above which the methods diverge. */
export const DIVERGENCE_THRESHOLD = 0.25;

export type ValueMethod = "justified-pe" | "dcf";

export interface Triangulation {
  /** Consensus margin of safety across the available value methods. */
  marginOfSafety: number | null;
  methodsUsed: ValueMethod[];
  divergence: "convergent" | "divergent" | "single-method" | "unavailable";
  /** |MoS_pe − MoS_dcf| when both methods are present, else null. */
  spread: number | null;
}

/**
 * Triangulate the justified-PE and DCF margin-of-safety readings into a
 * consensus + divergence classification. See the file header for the rules.
 */
export function computeTriangulation(args: {
  fairValue: FairValue;
  dcf: DcfValue;
}): Triangulation {
  const { fairValue, dcf } = args;

  const readings: Array<{ method: ValueMethod; mos: number }> = [];
  if (fairValue.available && fairValue.marginOfSafety != null) {
    readings.push({ method: "justified-pe", mos: fairValue.marginOfSafety });
  }
  if (dcf.available && dcf.marginOfSafety != null) {
    readings.push({ method: "dcf", mos: dcf.marginOfSafety });
  }

  if (readings.length === 0) {
    return { marginOfSafety: null, methodsUsed: [], divergence: "unavailable", spread: null };
  }

  if (readings.length === 1) {
    return {
      marginOfSafety: readings[0].mos,
      methodsUsed: [readings[0].method],
      divergence: "single-method",
      spread: null,
    };
  }

  const [a, b] = readings;
  const mean = (a.mos + b.mos) / 2;
  const spread = Math.abs(a.mos - b.mos);
  return {
    marginOfSafety: mean,
    methodsUsed: [a.method, b.method],
    divergence: spread <= DIVERGENCE_THRESHOLD ? "convergent" : "divergent",
    spread,
  };
}
