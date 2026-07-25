/**
 * Goal check — a real brokerage transaction file imports and reconstructs basis
 * (FIX-775). Real PATH (the OFX file format + the full parse → normalize →
 * derive-lots pipeline), out of CI, run by hand.
 *
 * There is no LLM in this path; the "real" surface this proves — the thing the
 * mocked CI specs can't — is that the parser handles what ACTUAL brokerages
 * emit. The held-out inputs are the files in `fixtures/`: drop a real
 * (anonymized) export from your institution beside an `<name>.expected.json`
 * stating the ending positions, and re-run. The runner hardcodes NO per-file
 * logic — it parses, validates every event against the canonical schema, runs
 * the real FIFO derivation, and reconciles the derived positions against the
 * fixture's own expectation.
 *
 * Run: pnpm tsx goals/transaction-file-import/reconstructs-basis-from-ofx/run.mts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { deriveLots } from "../../../labs/trading-desk/domain/portfolio/math/lots.ts";
import { parseOfxTransactions } from "../../../labs/trading-desk/domain/portfolio/parsers/portfolio-ofx.ts";
import {
  ledgerEventInputSchema,
  splitAttributesSchema,
  type LedgerRow,
  type SplitAttributes,
} from "../../../labs/trading-desk/domain/portfolio/schema/ledger-schema.ts";
import { fixtureDir, runGoal } from "../../lib/index.mts";

const FIXTURES = fixtureDir(import.meta.url);

type ExpectedPosition = { ticker: string; quantity: number; basisUnknown: boolean };
type Expected = {
  positions: ExpectedPosition[];
  unresolvedCusips: string[];
  skipped: number;
};

const EPS = 1e-6;

/**
 * Narrow a parsed event's `attributes` to the `LedgerRow` shape. The event
 * schema types it `unknown` (forward-compatible to future corporate actions);
 * a `LedgerRow` carries the split ratio typed. This re-applies exactly the
 * invariant `refineLedgerEvent` enforces at the ingest boundary: a valid split
 * payload, or null.
 */
function toRowAttributes(attributes: unknown): SplitAttributes | null {
  const parsed = splitAttributesSchema.safeParse(attributes);
  return parsed.success ? parsed.data : null;
}

async function checkFixture(file: string): Promise<string[]> {
  const failures: string[] = [];
  const content = readFileSync(join(FIXTURES, file), "utf8");
  const base = file.replace(/\.(qfx|qbo|ofx)$/i, "");
  const expected = JSON.parse(readFileSync(join(FIXTURES, `${base}.expected.json`), "utf8")) as Expected;

  const parsed = await parseOfxTransactions(content);

  // 1. The parse produced events, and every one is a valid canonical event
  //    (this catches a malformed mapping the way the ingest boundary would).
  if (parsed.events.length === 0) return [`${file}: parsed zero events`];
  for (const e of parsed.events) {
    const res = ledgerEventInputSchema.safeParse({ ...e, accountId: "goal", source: "file" });
    if (!res.success) {
      failures.push(`${file}: event failed canonical schema — ${res.error.issues[0]?.message}`);
    }
  }

  // 2. Run the REAL FIFO derivation over the parsed events and reconcile the
  //    ending positions against the fixture's expectation.
  const rows: LedgerRow[] = parsed.events.map((e, i) => ({
    ...e,
    id: `row-${i}`,
    accountId: "goal",
    userId: "goal",
    source: "file" as const,
    voidedAt: null,
    createdAt: `2026-01-01T00:00:0${i % 10}.000Z`,
    attributes: toRowAttributes((e as { attributes?: unknown }).attributes),
  }));
  const { positions } = deriveLots(rows);
  const byTicker = new Map(positions.map((p) => [p.ticker, p]));

  for (const exp of expected.positions) {
    const got = byTicker.get(exp.ticker);
    if (!got) {
      failures.push(`${file}: expected a ${exp.ticker} position, derived none`);
      continue;
    }
    if (Math.abs(got.quantity - exp.quantity) > EPS) {
      failures.push(`${file}: ${exp.ticker} qty ${got.quantity} ≠ expected ${exp.quantity}`);
    }
    if (got.hasUnknownBasis !== exp.basisUnknown) {
      failures.push(
        `${file}: ${exp.ticker} basisUnknown=${got.hasUnknownBasis} ≠ expected ${exp.basisUnknown}`,
      );
    }
  }

  // 3. The honesty surfaces: unresolved CUSIPs and skipped corporate actions
  //    match exactly (never silently dropped, never silently invented).
  const gotCusips = parsed.unresolvedSecurities.map((s) => s.cusip).sort();
  const expCusips = [...expected.unresolvedCusips].sort();
  if (JSON.stringify(gotCusips) !== JSON.stringify(expCusips)) {
    failures.push(`${file}: unresolved CUSIPs [${gotCusips}] ≠ expected [${expCusips}]`);
  }
  if (parsed.skipped.length !== expected.skipped) {
    failures.push(`${file}: skipped ${parsed.skipped.length} ≠ expected ${expected.skipped}`);
  }
  return failures;
}

await runGoal(async () => {
  const files = readdirSync(FIXTURES).filter((f) => /\.(qfx|qbo|ofx)$/i.test(f));
  if (files.length === 0) {
    return { failures: ["no OFX-family fixtures found in fixtures/"], evidence: "" };
  }
  const failures: string[] = [];
  for (const file of files) failures.push(...(await checkFixture(file)));

  return {
    failures,
    evidence:
      `${files.length} OFX-family file(s) parsed, every event canonical-valid, ` +
      `FIFO positions + basis-unknown flags + unresolved CUSIPs + skipped corporate ` +
      `actions all reconciled against the held-out expectations.`,
  };
});
