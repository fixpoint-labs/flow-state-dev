/**
 * Test helper for the app-owned portfolio repository (FIX-772).
 *
 * The flow seed (`seedSession`) and the portfolio action handlers now read/write
 * accounts + holdings through `getRepository()` from `@/db/portfolio-db` instead
 * of an FSD resource. In tests that singleton would try to open the persisted
 * `.fsdev/pglite` dir, so each affected spec mocks the module:
 *
 *   const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
 *   vi.mock("@/db/portfolio-db", () => ({
 *     getRepository: async () => repoState.repo!,
 *   }));
 *   beforeEach(async () => { repoState.repo = await makeTestRepository(); });
 *
 * Seed accounts with the SAME userId the harness assigns: `testBlock` defaults
 * to `"test-user"`; `testFlow` uses the explicit `userId` option. Collateral
 * specs that only need the seed not to crash leave the repo empty (no accounts →
 * portfolio-blind run, the prior default).
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createMigratedPgliteDb } from "@/db/client";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "@/db/repository";
import type { AccountType, CanonicalRow } from "@/domain/portfolio/schema/portfolio-schema";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../db/migrations", import.meta.url));

/** A fresh, isolated in-memory portfolio repository (migrated `app.*` schema). */
export async function makeTestRepository(): Promise<PortfolioRepository> {
  return createPortfolioRepository(await createMigratedPgliteDb(new PGlite(), MIGRATIONS_DIR));
}

/** Seed one account + its holdings, mirroring the inline-record shape the old
 *  resource fixtures used. `holdings` defaults to none. */
export async function seedAccount(
  repo: PortfolioRepository,
  account: {
    accountId: string;
    userId: string;
    name?: string;
    type?: AccountType;
    currency?: string;
    cashBalance?: number;
    riskMandate?: string | null;
    holdings?: CanonicalRow[];
  },
): Promise<void> {
  await repo.upsertAccount({
    id: account.accountId,
    userId: account.userId,
    name: account.name ?? "Account",
    type: account.type ?? "taxable",
    currency: account.currency ?? "USD",
    cashBalance: account.cashBalance ?? 0,
    riskMandate: account.riskMandate ?? null,
  });
  if (account.holdings && account.holdings.length > 0) {
    await repo.upsertHoldings(account.accountId, account.userId, account.holdings, "replace-account");
  }
}
