/**
 * Tests that `seedSession` resolves the effective risk-appetite mandate
 * (FIX-752) and freezes it onto session state: a per-run override wins; else the
 * most-conservative default among the selected accounts; else mandate-blind.
 *
 * Drives `seedSession` directly via `testBlock` (the seed-portfolio-snapshot
 * shape), seeding user-scoped accounts that carry a `riskMandate` default.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { makeTestRepository, seedAccount } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/src/db/repository";

// Accounts + holdings moved to the app-owned repository (FIX-772). Mock the
// repo to a fresh in-memory PGlite instance per test; seedSession reads the
// effective mandate from the seeded accounts.
const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import { seedSession } from "../src/flows/analysis/orchestration/guards";
import type { RiskMandateId } from "../src/flows/analysis/lib/risk-mandate";
import flow from "../src/flows/analysis/flow";

/** testBlock's default request userId — the household key seedSession resolves. */
const TEST_USER = "test-user";

function account(id: string, riskMandate: string | null) {
  return { accountId: id, riskMandate };
}

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
});

const baseInput = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  userThesis: null,
  userThesisRationale: null,
  selectedAccountIds: [] as string[],
  riskMandate: null as RiskMandateId | null,
};

async function seedWith(opts: {
  input?: Partial<typeof baseInput>;
  accounts?: Array<ReturnType<typeof account>>;
}) {
  for (const acc of opts.accounts ?? []) {
    await seedAccount(repoState.repo!, {
      accountId: acc.accountId,
      userId: TEST_USER,
      name: acc.accountId,
      type: "taxable",
      cashBalance: 1000,
      riskMandate: acc.riskMandate,
    });
  }
  const result = await testBlock(seedSession, {
    input: { ...baseInput, ...opts.input },
    flow,
  });
  expect(result.error).toBeNull();
  return result.state.session as { riskMandate?: { id: string } | null };
}

describe("seedSession risk-mandate resolution", () => {
  it("a per-run override beats the account default", async () => {
    const state = await seedWith({
      input: { riskMandate: "aggressive-growth" },
      accounts: [account("a1", "conservative-income")],
    });
    expect(state.riskMandate?.id).toBe("aggressive-growth");
  });

  it("falls back to the selected account's default when no override is given", async () => {
    const state = await seedWith({
      accounts: [account("a1", "balanced")],
    });
    expect(state.riskMandate?.id).toBe("balanced");
  });

  it("binds the most conservative default when selected accounts disagree", async () => {
    const state = await seedWith({
      accounts: [
        account("a1", "aggressive-growth"),
        account("a2", "conservative-income"),
        account("a3", "balanced"),
      ],
    });
    expect(state.riskMandate?.id).toBe("conservative-income");
  });

  it("scopes the default to the selected accounts only", async () => {
    const state = await seedWith({
      input: { selectedAccountIds: ["a1"] },
      accounts: [
        account("a1", "aggressive-growth"),
        account("a2", "conservative-income"), // not selected → ignored
      ],
    });
    expect(state.riskMandate?.id).toBe("aggressive-growth");
  });

  it("is mandate-blind (null) when neither an override nor a default resolves", async () => {
    const state = await seedWith({
      accounts: [account("a1", null), account("a2", "bogus-id")],
    });
    expect(state.riskMandate ?? null).toBeNull();
  });

  it("is mandate-blind when there are no accounts and no override", async () => {
    const state = await seedWith({});
    expect(state.riskMandate ?? null).toBeNull();
  });
});
