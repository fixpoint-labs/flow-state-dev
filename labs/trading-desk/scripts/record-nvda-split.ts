/**
 * Record the NVIDIA 10-for-1 stock split (effective 2024-06-10) into the ledger
 * (FIX-876), restoring the NVDA position in `WF: Investing Accounts`.
 *
 * Why a script, not a migration: this is a real-money DATA fix, recorded through
 * the SAME `ingestLedgerEvents` contract manual entry uses (source `"manual"`),
 * not a schema change — so it is reproducible and audit-trailed. Before this
 * split existed in the ledger, FIFO over-sold the small pre-split NVDA lots with
 * the 10×-larger post-split sells, netted the position negative, and (pre-FIX-876)
 * silently deleted the holdings row. With the split recorded, `deriveLots` rebases
 * the pre-split lots ×10 (basis ÷10) at 2024-06-10, so the post-split sells consume
 * the rebased lots correctly and the position derives to its true 121.9346 shares.
 *
 * Idempotent: the split's content fingerprint (`account|2024-06-10|split|NVDA|`) is
 * fixed, so re-running dedups to the one row (reports `deduplicated`, not a second
 * split). Runs against whatever backing `getRepository()` resolves — embedded
 * PGlite in dev, real Postgres when `DATABASE_URL`/`FSD_DB_URL` is set.
 *
 *   pnpm --filter @flow-state-dev/trading-desk nvda-split
 *
 * Override the household / account with `NVDA_SPLIT_USER` / `NVDA_SPLIT_ACCOUNT`.
 */
import { getRepository } from "../db/portfolio-db";

const USER_ID = process.env.NVDA_SPLIT_USER ?? "devuser";
const ACCOUNT_NAME = process.env.NVDA_SPLIT_ACCOUNT ?? "WF: Investing Accounts";

const repo = await getRepository();
const accounts = await repo.getAccountsForUser(USER_ID);
const account = accounts.find((a) => a.name === ACCOUNT_NAME);
if (account === undefined) {
  console.error(
    `[nvda-split] No account named "${ACCOUNT_NAME}" for user "${USER_ID}". ` +
      `Accounts found: ${accounts.map((a) => a.name).join(", ") || "(none)"}.`,
  );
  process.exit(1);
}

const report = await repo.ingestLedgerEvents(
  [
    {
      accountId: account.accountId,
      type: "split",
      tradeDate: "2024-06-10",
      settleDate: null,
      ticker: "NVDA",
      quantity: null,
      unitPrice: null,
      amount: 0,
      fee: null,
      currency: "USD",
      source: "manual",
      externalId: null,
      description: "NVIDIA 10-for-1 stock split (effective 2024-06-10)",
      basisUnknown: null,
      proceedsUnknown: null,
      attributes: { numerator: 10, denominator: 1 },
    },
  ],
  USER_ID,
);
console.log(
  `[nvda-split] ingest: inserted=${report.inserted} deduplicated=${report.deduplicated}`,
);

const { holdings } = await repo.getPortfolio(USER_ID);
const nvda = holdings.filter((h) => h.accountId === account.accountId && h.ticker === "NVDA");
if (nvda.length === 0) {
  console.log("[nvda-split] NVDA still derives to no open position — check the imported trades.");
} else {
  for (const h of nvda) {
    console.log(
      `[nvda-split] NVDA now derives to ${h.quantity} shares` +
        `${h.costBasis === null ? "" : ` at avg cost ${h.costBasis}`}` +
        `${h.dataQuality ? ` (flagged: ${h.dataQuality})` : ""}.`,
    );
  }
}
process.exit(0);
