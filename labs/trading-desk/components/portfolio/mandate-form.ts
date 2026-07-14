/**
 * Pure form ↔ payload mapping for the portfolio-mandate editor (FIX-761). The
 * dialog stays dumb: it holds raw input strings and delegates the load-bearing
 * mapping — pre-filling from an existing record, building the
 * `savePortfolioMandate` input, and client-side validation — to these tested
 * pure helpers (the `thesis-form.ts` precedent).
 *
 * Real-money discipline: a blank optional field maps to `null`, never a
 * fabricated value; an unparseable number is caught as a validation error (it
 * would otherwise silently null out an existing value). The server re-validates
 * with the same `validatePortfolioMandate`, so the client validation mirrors it.
 *
 * Browser-safe: imports only the browser-safe mandate schema leaf.
 */
import type { z } from "zod";
import {
  mandateAssetClassSchema,
  portfolioMandateSchema,
  validatePortfolioMandate,
  type BandType,
  type MandateAssetClass,
  type PortfolioMandate,
  type RiskTolerance,
} from "@/src/domain/portfolio/schema/portfolio-mandate-schema";

/** The MANDATE_PACK appetite ids the dropdown offers (kept here so the UI form
 *  doesn't import the analysis-flow risk-mandate module). "" means "derive from
 *  the risk tolerance" (the seed default). */
export const APPETITE_OPTIONS = [
  { value: "", label: "Derive from risk tolerance" },
  { value: "conservative-income", label: "Conservative income" },
  { value: "balanced", label: "Balanced" },
  { value: "aggressive-growth", label: "Aggressive growth" },
] as const;

export const ASSET_CLASS_OPTIONS: readonly MandateAssetClass[] =
  mandateAssetClassSchema.options;

/** One target-allocation row as the editor holds it: raw strings so an
 *  in-progress, not-yet-numeric row never throws. */
export type AllocationRowDraft = {
  assetClass: MandateAssetClass;
  targetPct: string;
  minPct: string;
  maxPct: string;
};

/** The editor's full draft state — raw strings, one per field. */
export type MandateFormState = {
  label: string;
  riskTolerance: RiskTolerance;
  returnTargetPct: string;
  returnBasis: "" | "nominal" | "real";
  riskAppetite: string;
  horizonYears: string;
  maxPositionWeightPct: string;
  minCashPct: string;
  /** Comma / whitespace separated tickers; canonicalized on build. */
  exclusions: string;
  bandType: BandType;
  bandWidthPct: string;
  targetAllocation: AllocationRowDraft[];
};

/** The empty draft for a brand-new mandate. */
export function emptyMandateForm(): MandateFormState {
  return {
    label: "Portfolio mandate",
    riskTolerance: "moderate",
    returnTargetPct: "",
    returnBasis: "",
    riskAppetite: "",
    horizonYears: "",
    maxPositionWeightPct: "",
    minCashPct: "",
    exclusions: "",
    bandType: "relative",
    bandWidthPct: "",
    targetAllocation: [],
  };
}

/** The set of appetite ids the dropdown can represent (the `""` derive-option
 *  aside). A persisted mandate may carry a STALE/unknown id (the seed tolerates
 *  it — old constraints still apply), but the editor can only show an id it
 *  offers; pre-filling an unknown id would silently resubmit it on save and the
 *  action would reject it after the dialog closed. So `mandateRecordToForm`
 *  normalizes an unknown id back to `""` (derive from tolerance), letting the
 *  user repair the record instead of hitting a silent failed save. */
const KNOWN_APPETITE_IDS = new Set<string>(
  APPETITE_OPTIONS.map((o) => o.value).filter((v) => v !== ""),
);

/** Pre-fill the draft from an existing mandate record (the edit path). */
export function mandateRecordToForm(record: PortfolioMandate): MandateFormState {
  const num = (n: number | null): string => (n === null ? "" : String(n));
  const appetite = record.riskAppetite ?? "";
  return {
    label: record.label,
    riskTolerance: record.objectives.riskTolerance,
    returnTargetPct: num(record.objectives.returnTargetPct),
    returnBasis: record.objectives.returnBasis ?? "",
    // Drop a stale/unknown appetite id back to "" so the editor doesn't resubmit
    // an id the save action will reject (the dropdown only offers known ids).
    riskAppetite: KNOWN_APPETITE_IDS.has(appetite) ? appetite : "",
    horizonYears: num(record.timeHorizon.years),
    maxPositionWeightPct: num(record.constraints.maxPositionWeightPct),
    minCashPct: num(record.constraints.minCashPct),
    exclusions: record.constraints.exclusions.join(", "),
    bandType: record.rebalancing.bandType,
    // Show the RELATIVE band as its stored fraction (0.2), the absolute as pp (5).
    bandWidthPct: String(record.rebalancing.bandWidthPct),
    targetAllocation: record.targetAllocation.map((a) => ({
      assetClass: a.assetClass,
      targetPct: String(a.targetPct),
      minPct: num(a.minPct),
      maxPct: num(a.maxPct),
    })),
  };
}

/** Parse an optional numeric field. Blank → null; otherwise the parsed number,
 *  or null when unparseable (validation catches the non-blank-unparseable case). */
function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed.replace(/[%,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isUnparseableNumber(raw: string): boolean {
  return raw.trim().length > 0 && parseOptionalNumber(raw) === null;
}

/** Split the exclusions text into canonical upper-case tickers (the action
 *  re-canonicalizes; this keeps the client preview honest). */
function parseExclusions(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((e) => e.trim().toUpperCase())
        .filter((e) => e.length > 0),
    ),
  ];
}

/** The `savePortfolioMandate` action input shape (omits the action-owned
 *  timestamps). The schema INPUT type — so `rebalancing.bandWidthPct` may be
 *  omitted (the transform fills the unit-correct default), matching the action's
 *  own input contract. */
export type MandateSavePayload = Omit<
  z.input<typeof portfolioMandateSchema>,
  "createdAt" | "updatedAt"
>;

/**
 * Build the `savePortfolioMandate` input from the draft. Blank optional fields
 * collapse to null; a target-allocation row with a blank target is dropped (an
 * empty scaffold, not a policy). A blank band width is omitted so the schema
 * transform fills the unit-correct default.
 */
export function buildSaveMandatePayload(form: MandateFormState): MandateSavePayload {
  const bandWidth = parseOptionalNumber(form.bandWidthPct);
  return {
    label: form.label.trim().length === 0 ? "Portfolio mandate" : form.label.trim(),
    objectives: {
      riskTolerance: form.riskTolerance,
      returnTargetPct: parseOptionalNumber(form.returnTargetPct),
      returnBasis: form.returnBasis === "" ? null : form.returnBasis,
    },
    targetAllocation: form.targetAllocation
      .filter((r) => r.targetPct.trim().length > 0)
      .map((r) => ({
        assetClass: r.assetClass,
        targetPct: parseOptionalNumber(r.targetPct) ?? 0,
        minPct: parseOptionalNumber(r.minPct),
        maxPct: parseOptionalNumber(r.maxPct),
      })),
    constraints: {
      maxPositionWeightPct: parseOptionalNumber(form.maxPositionWeightPct),
      minCashPct: parseOptionalNumber(form.minCashPct),
      exclusions: parseExclusions(form.exclusions),
    },
    // A blank band width lets the schema transform fill the per-type default.
    rebalancing: bandWidth === null
      ? { bandType: form.bandType }
      : { bandType: form.bandType, bandWidthPct: bandWidth },
    timeHorizon: { years: parseOptionalNumber(form.horizonYears) },
    riskAppetite: form.riskAppetite === "" ? null : form.riskAppetite,
  };
}

/**
 * Validate the built payload against the SAME `validatePortfolioMandate` the
 * action re-validates server-side, returning the first human-readable issue or
 * null when valid. The dialog calls this on save so an input the server would
 * reject keeps the editor open instead of dispatching, closing, and silently
 * losing the draft (`sendAction` resolves at stream-attach, before the rejection
 * surfaces). Also catches a non-blank-unparseable number BEFORE it collapses to
 * null in the payload (which would silently erase an existing value).
 */
export function mandateFormError(form: MandateFormState): string | null {
  if (isUnparseableNumber(form.returnTargetPct)) return "Return target: enter a number (or leave blank)";
  if (isUnparseableNumber(form.horizonYears)) return "Time horizon: enter a number of years (or leave blank)";
  if (isUnparseableNumber(form.maxPositionWeightPct)) return "Max position weight: enter a percent (or leave blank)";
  if (isUnparseableNumber(form.minCashPct)) return "Minimum cash: enter a percent (or leave blank)";
  if (isUnparseableNumber(form.bandWidthPct)) return "Rebalancing band: enter a number (or leave blank)";
  for (let i = 0; i < form.targetAllocation.length; i++) {
    const r = form.targetAllocation[i];
    if (r.targetPct.trim().length > 0 && isUnparseableNumber(r.targetPct)) {
      return `Allocation row ${i + 1}: target must be a number`;
    }
    if (isUnparseableNumber(r.minPct)) return `Allocation row ${i + 1}: min must be a number (or blank)`;
    if (isUnparseableNumber(r.maxPct)) return `Allocation row ${i + 1}: max must be a number (or blank)`;
  }

  const payload = buildSaveMandatePayload(form);
  // Parse through the schema (fills defaults + the band transform), then run the
  // business validator with placeholder timestamps (which it does not read).
  const parsed = portfolioMandateSchema.safeParse({
    ...payload,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.join(".");
    return field.length > 0 ? `${field}: ${issue.message}` : issue.message;
  }
  const issues = validatePortfolioMandate(parsed.data);
  return issues.length > 0 ? issues[0] : null;
}
