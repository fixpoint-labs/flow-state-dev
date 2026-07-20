/**
 * Goal check — a newly listed issuer's prospectus financials are recovered,
 * not voided (FIX-898). See goal.md for the contract.
 *
 * Drives the REAL deterministic recovery path (extract → validate → promote)
 * against the SPCX-shaped 424B4 fixture. Zero models, zero network. Asserts the
 * promote path populates the valuation-critical fields tagged `edgar-prospectus`
 * in USD billions, AND that a decade-stale variant is rejected (the honest
 * `unavailable` path). The single-flight runtime + LLM fallback + live wiring are
 * pinned by the vitest specs referenced in goal.md.
 *
 * Run: pnpm tsx goals/trading-desk-financials/ipo-prospectus-recovery/run.mts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractProspectusFinancials } from "../../../labs/trading-desk/lib/providers/prospectus-financials";
import { promoteCandidate } from "../../../labs/trading-desk/flows/analysis/lib/financial-candidate";
import { validateFinancialCandidate } from "../../../labs/trading-desk/flows/analysis/lib/validate-financial-candidate";

const html = readFileSync(
  fileURLToPath(
    new URL("../../../labs/trading-desk/test/__fixtures__/spcx-prospectus.html", import.meta.url),
  ),
  "utf8",
);

const meta = {
  ticker: "SPCX",
  cik: 1750000,
  form: "424B4",
  filingDate: "2026-02-10",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1750000/000000000026000004/424b4.htm",
  companyName: "SpaceCo Exploration Inc.",
};
const validateCtx = {
  ticker: "SPCX",
  expectedCik: 1750000,
  asOfDate: "2026-05-06",
  expectedName: "SpaceCo Exploration Inc.",
};

const failures: string[] = [];

// 1. The successful recovery path.
const candidate = extractProspectusFinancials(html, meta);
if (!candidate) {
  failures.push("deterministic extract returned null on the SPCX fixture");
} else {
  const verdict = validateFinancialCandidate(candidate, validateCtx);
  if (!verdict.ok) failures.push(`valid candidate rejected: ${verdict.reasons.join(", ")}`);
  const { incomeStatement, cashflow } = promoteCandidate(candidate);
  if (incomeStatement.source !== "edgar-prospectus") {
    failures.push(`source ${incomeStatement.source} !== edgar-prospectus`);
  }
  if (incomeStatement.unit !== "USD billions") failures.push("unit not USD billions");
  if (incomeStatement.revenue == null) failures.push("revenue null after recovery");
  if (incomeStatement.operatingIncome == null) failures.push("operating income null after recovery");
  if (cashflow.freeCashFlow == null) failures.push("free cash flow null after recovery");
}

// 2. The honest-unavailable path: a decade-stale prospectus must be rejected.
const staleHtml = html
  .replace(/December 31, 2025/g, "December 31, 2014")
  .replace(/December 31, 2024/g, "December 31, 2013");
const staleCandidate = extractProspectusFinancials(staleHtml, meta);
if (!staleCandidate) {
  // Extraction is allowed to still parse it; the GATE is what must reject.
  failures.push("stale fixture failed to extract (cannot test the reject gate)");
} else {
  const staleVerdict = validateFinancialCandidate(staleCandidate, validateCtx);
  if (staleVerdict.ok) failures.push("stale candidate was NOT rejected (validation is a no-op)");
  if (staleVerdict.reasons.length === 0) failures.push("rejected candidate has no reason trail");
}

if (failures.length === 0) {
  const promoted = promoteCandidate(candidate!);
  console.log(
    `PASS — SPCX prospectus recovered: revenue $${promoted.incomeStatement.revenue}B, ` +
      `operating income $${promoted.incomeStatement.operatingIncome}B, ` +
      `FCF $${promoted.cashflow.freeCashFlow}B (edgar-prospectus). ` +
      `Stale variant rejected honestly.`,
  );
  process.exit(0);
}

console.error("FAIL —\n" + failures.join("\n"));
process.exit(1);
