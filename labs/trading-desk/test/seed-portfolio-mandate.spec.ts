/**
 * Tests that `seedSession` reads the durable household portfolio mandate
 * (FIX-761), re-validates it, freezes it onto `state.portfolioMandate`, folds its
 * appetite into the FIX-752 resolution chain, and freezes the analyzed ticker's
 * HOUSEHOLD weight for the PM commit's policy gate.
 *
 * Drives `seedSession` directly via `testBlock`, seeding the mandate into the
 * user-scoped `portfolioMandate` resource (and accounts/holdings/quotes into the
 * mocked repository for the household-weight case).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { makeTestRepository, seedAccount } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/src/db/repository";
import {
  portfolioMandateSchema,
  type PortfolioMandate,
} from "../src/flows/portfolio/portfolio-mandate-schema";

const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import { seedSession } from "../src/flows/analysis/orchestration/guards";
import flow from "../src/flows/analysis/flow";

const TEST_USER = "test-user";

const baseInput = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  userThesis: null,
  userThesisRationale: null,
  riskMandate: null as string | null,
  selectedAccountIds: [] as string[],
};

/** A schema-valid mandate record (defaults + rebalancing transform applied). */
function mandate(overrides: Record<string, unknown> = {}): PortfolioMandate {
  return portfolioMandateSchema.parse({
    objectives: { riskTolerance: "moderate" },
    constraints: {},
    rebalancing: {},
    timeHorizon: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

type SeedResult = {
  portfolioMandate?: PortfolioMandate | null;
  riskMandate?: { id: string } | null;
  householdTickerWeightPct?: number | null;
};

async function seed(opts: {
  input?: Partial<typeof baseInput>;
  mandate?: PortfolioMandate | null;
  accounts?: Array<{ accountId: string; riskMandate: string | null }>;
}): Promise<SeedResult> {
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
    ...(opts.mandate != null
      ? { user: { resources: { portfolioMandate: opts.mandate } } }
      : {}),
  });
  expect(result.error).toBeNull();
  return result.state.session as SeedResult;
}

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
});

describe("seedSession portfolio-mandate resolution", () => {
  it("freezes a valid mandate onto state.portfolioMandate", async () => {
    const state = await seed({ mandate: mandate({ label: "Household IPS 2026" }) });
    expect(state.portfolioMandate?.label).toBe("Household IPS 2026");
  });

  it("folds the IPS explicit appetite in below the account default", async () => {
    // No override, no account default → the IPS household appetite binds.
    const state = await seed({
      mandate: mandate({ riskAppetite: "conservative-income" }),
      accounts: [{ accountId: "a1", riskMandate: null }],
    });
    expect(state.riskMandate?.id).toBe("conservative-income");
  });

  it("account default still beats the IPS household appetite", async () => {
    const state = await seed({
      mandate: mandate({ riskAppetite: "conservative-income" }),
      accounts: [{ accountId: "a1", riskMandate: "balanced" }],
    });
    expect(state.riskMandate?.id).toBe("balanced");
  });

  it("a run override still beats everything", async () => {
    const state = await seed({
      input: { riskMandate: "aggressive-growth" },
      mandate: mandate({ riskAppetite: "conservative-income" }),
      accounts: [{ accountId: "a1", riskMandate: "balanced" }],
    });
    expect(state.riskMandate?.id).toBe("aggressive-growth");
  });

  it("DERIVES the appetite 1:1 from riskTolerance when riskAppetite is null", async () => {
    const state = await seed({
      mandate: mandate({ objectives: { riskTolerance: "aggressive" } }),
      accounts: [{ accountId: "a1", riskMandate: null }],
    });
    expect(state.riskMandate?.id).toBe("aggressive-growth");
  });

  it("degrades a business-invalid persisted record to mandate-blind", async () => {
    // Schema-valid (each targetPct ≤ 100) but business-invalid (no-cash sum > 100).
    const invalid = mandate({
      targetAllocation: [
        { assetClass: "equity", targetPct: 70 },
        { assetClass: "fixed_income", targetPct: 40 },
      ],
      objectives: { riskTolerance: "aggressive" },
    });
    const state = await seed({
      mandate: invalid,
      accounts: [{ accountId: "a1", riskMandate: null }],
    });
    expect(state.portfolioMandate).toBeNull();
    // The whole IPS degraded — the tolerance-derived appetite does not apply.
    expect(state.riskMandate ?? null).toBeNull();
  });

  it("keeps constraints but drops only the appetite for a stale/unknown riskAppetite id", async () => {
    const state = await seed({
      mandate: mandate({
        riskAppetite: "totally-made-up",
        constraints: { maxPositionWeightPct: 5, exclusions: ["TSLA"] },
      }),
      accounts: [{ accountId: "a1", riskMandate: null }],
    });
    // Constraints survive — the mandate is still frozen.
    expect(state.portfolioMandate?.constraints.maxPositionWeightPct).toBe(5);
    // Only the appetite degrades to null (no resolvable id, no account default).
    expect(state.riskMandate ?? null).toBeNull();
  });

  it("is mandate-blind when no mandate resource is set", async () => {
    const state = await seed({ accounts: [{ accountId: "a1", riskMandate: null }] });
    expect(state.portfolioMandate ?? null).toBeNull();
  });
});

describe("seedSession household ticker weight (FIX-761)", () => {
  it("measures the household weight against the full book on a scoped run", async () => {
    // Account A holds NVDA only; account B holds AAPL + cash. Scoping to A must
    // NOT make the household NVDA weight 100% — it stays the full-book share.
    await seedAccount(repoState.repo!, {
      accountId: "acc-a",
      userId: TEST_USER,
      name: "A",
      type: "taxable",
      cashBalance: 0,
      holdings: [
        { ticker: "NVDA", quantity: 5, costBasis: 90, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
      ],
    });
    await seedAccount(repoState.repo!, {
      accountId: "acc-b",
      userId: TEST_USER,
      name: "B",
      type: "taxable",
      cashBalance: 500,
      holdings: [
        { ticker: "AAPL", quantity: 5, costBasis: 90, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
      ],
    });
    await repoState.repo!.upsertQuotes([
      { ticker: "NVDA", price: 100, asOf: "2026-05-06T00:00:00.000Z", source: "live" },
      { ticker: "AAPL", price: 100, asOf: "2026-05-06T00:00:00.000Z", source: "live" },
    ]);

    const state = await seed({ input: { selectedAccountIds: ["acc-a"] } });
    // Household NAV = 500 (NVDA) + 500 (AAPL) + 500 cash = 1500; NVDA = 500/1500.
    expect(state.householdTickerWeightPct).toBeCloseTo(33.33, 1);
  });

  it("is 0 for a not-held name (initiating)", async () => {
    await seedAccount(repoState.repo!, {
      accountId: "acc-a",
      userId: TEST_USER,
      name: "A",
      type: "taxable",
      cashBalance: 1000,
    });
    const state = await seed({ input: { ticker: "MSFT" } });
    expect(state.householdTickerWeightPct).toBe(0);
  });
});
