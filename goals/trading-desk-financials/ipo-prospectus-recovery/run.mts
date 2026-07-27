/**
 * Goal check — a newly listed issuer's prospectus financials are recovered,
 * not voided (FIX-898; FIX-913 collapsed recovery to the model tier). See
 * goal.md for the contract.
 *
 * Drives the REAL model tier — `recoverFinancialsExtract` (a real
 * `openai/gpt-5.4-mini` call) over the SPCX-shaped 424B4 fixture → the hard
 * validator → the promote mapping — the ONLY extraction step now that the
 * deterministic parser is gone. Loops RUNS=5 and passes iff ALL five promote
 * (unanimous), always printing `k/5` so any miss is visible: the run-to-run
 * stability of the model tier is the honest cost signal of the reduction. A
 * zero-model anti-game arm (a poisoned candidate → the pure validator) proves the
 * validator is not a no-op without depending on the model.
 *
 * NOTE the retry semantics here are NOT the corpus's usual retry-until-first-pass
 * (which tolerates model flakiness over a mechanism). This requires k-of-k
 * BECAUSE the stability number is itself the published result. Do not swap it
 * for a first-pass loop.
 *
 * The single-flight runtime, the fetch loop, the audit write, and the live
 * statement-chain wiring are unchanged by this reduction and are pinned by the
 * mocked vitest specs (`critical-financials-recovery.spec.ts`,
 * `financials-recovery-spine.spec.ts`) — this goal proves "model + gate clears a
 * real filing", not that plumbing.
 *
 * Requires an inference credential (Vercel AI Gateway `AI_GATEWAY_API_KEY` or a
 * provider key the resolver uses). Run with cwd `labs/trading-desk` so the
 * gateway package resolves:
 *   cd labs/trading-desk && pnpm tsx ../../goals/trading-desk-financials/ipo-prospectus-recovery/run.mts
 */
import { readFileSync } from "node:fs";
import { createModelResolver } from "@flow-state-dev/core";
import { recoverFinancialsExtract } from "../../../labs/trading-desk/flows/analysis/tools/runtime/recover-financials-extract";
import {
  promoteCandidate,
  type FinancialCandidate,
} from "../../../labs/trading-desk/flows/analysis/lib/financial-candidate";
import { validateFinancialCandidate } from "../../../labs/trading-desk/flows/analysis/lib/validate-financial-candidate";
import { DEFAULT_MODEL, TRADING_DESK, runGoal, stripIntentOverrides } from "../../lib/index.mts";

const html = readFileSync(
  `${TRADING_DESK}/test/__fixtures__/spcx-prospectus.html`,
  "utf8",
);

const SEC_URL = "https://www.sec.gov/Archives/edgar/data/1750000/000000000026000004/424b4.htm";
const meta = { ticker: "SPCX", cik: 1750000, companyName: "SpaceCo Exploration Inc." };
const validateCtx = {
  ticker: "SPCX",
  expectedCik: 1750000,
  asOfDate: "2026-05-06",
  expectedName: "SpaceCo Exploration Inc.",
};

// Strip the ambient intent-ladder overrides first: createModelResolver({})
// declares no intents, and the core resolver THROWS ("FSDEV_DEFAULT_MODEL was
// set, but no intents are declared") when they're present.
stripIntentOverrides();

const resolve = createModelResolver({}); // auto-detects the provider gateway from env
const model = resolve(DEFAULT_MODEL); // a GeneratorModel — .generate matches ExtractModel

const RUNS = 5;

async function runPromoteArm(): Promise<{ ok: boolean; detail: string }> {
  const candidate = await recoverFinancialsExtract(
    model,
    [{ url: SEC_URL, text: html, form: "424B4", filingDate: "2026-02-10" }],
    meta,
  );
  if (!candidate) return { ok: false, detail: "model returned no usable candidate" };
  const verdict = validateFinancialCandidate(candidate, validateCtx);
  if (!verdict.ok) return { ok: false, detail: `rejected by validator: ${verdict.reasons.join(", ")}` };
  const { incomeStatement, cashflow } = promoteCandidate(candidate);
  const problems: string[] = [];
  if (incomeStatement.source !== "edgar-prospectus") problems.push(`source ${incomeStatement.source}`);
  if (incomeStatement.unit !== "USD billions") problems.push("unit not USD billions");
  if (incomeStatement.revenue == null) problems.push("revenue null");
  if (incomeStatement.operatingIncome == null) problems.push("operating income null");
  if (cashflow.freeCashFlow == null) problems.push("FCF null");
  if (problems.length) return { ok: false, detail: `promoted but ${problems.join(", ")}` };
  return {
    ok: true,
    detail:
      `revenue $${incomeStatement.revenue}B, operating income $${incomeStatement.operatingIncome}B, ` +
      `FCF $${cashflow.freeCashFlow}B (edgar-prospectus)`,
  };
}

await runGoal(async () => {
  const failures: string[] = [];

  // 1. Promote arm — the real model tier, looped for stability. Pass iff k === RUNS.
  let k = 0;
  for (let i = 1; i <= RUNS; i++) {
    const r = await runPromoteArm();
    if (r.ok) k++;
    console.log(`run ${i}/${RUNS} ${r.ok ? "PASS" : "FAIL"} — ${r.detail}`);
  }
  console.log(`\nPromote-arm stability: ${k}/${RUNS} promoted.`);
  if (k !== RUNS) {
    failures.push(
      `promote arm not unanimous: ${k}/${RUNS}. Run-to-run flakiness of the model tier ` +
        `against the validator is the measured cost of dropping the deterministic parser (report it, don't hide it).`,
    );
  }

  // 2. Anti-game arm (zero-model): a hand-built poisoned candidate (a decade-stale
  // period) fed straight to the pure validator must be rejected with reasons —
  // proving the validator is not a no-op, independent of the model.
  const poisoned: FinancialCandidate = {
    ticker: "SPCX",
    cik: 1750000,
    companyName: "SpaceCo Exploration Inc.",
    form: "424B4",
    filingDate: "2026-02-10",
    periodEnd: "2015-12-31", // a decade stale → the stale-period gate must reject
    scale: 1_000_000_000,
    currency: "USD",
    sourceUrl: SEC_URL,
    income: { revenue: 8_500_000_000, operatingIncome: 1_200_000_000 },
    cashflow: { operating: 2_000_000_000, capitalExpenditure: -3_500_000_000, freeCashFlow: null },
    balance: { cashAndEquivalents: 4_000_000_000, totalDebt: 1_000_000_000 },
  };
  const poisonedVerdict = validateFinancialCandidate(poisoned, validateCtx);
  if (poisonedVerdict.ok) {
    failures.push("poisoned (stale) candidate was NOT rejected — the validator is a no-op");
  } else if (poisonedVerdict.reasons.length === 0) {
    failures.push("poisoned candidate rejected with no reason trail");
  } else {
    console.log(`Anti-game arm: poisoned candidate rejected (${poisonedVerdict.reasons.join(", ")}).`);
  }

  return {
    failures,
    evidence: `SPCX prospectus recovered on the MODEL TIER ALONE, ${k}/${RUNS} runs, and the stale variant was rejected honestly.`,
  };
});
