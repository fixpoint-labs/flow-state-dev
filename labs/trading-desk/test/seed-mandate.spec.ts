/**
 * Tests that `seedSession` resolves the effective risk-appetite mandate
 * (FIX-752) and freezes it onto session state: a per-run override wins; else the
 * most-conservative default among the selected accounts; else mandate-blind.
 *
 * Drives `seedSession` directly via `testBlock` (the seed-portfolio-snapshot
 * shape), seeding user-scoped accounts that carry a `riskMandate` default.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { seedSession } from "../src/flows/analysis/orchestration/guards";
import type { RiskMandateId } from "../src/flows/analysis/lib/risk-mandate";
import flow from "../src/flows/analysis/flow";

function account(id: string, riskMandate: string | null) {
  return {
    accountId: id,
    name: id,
    type: "taxable",
    currency: "USD",
    cashBalance: 1000,
    holdings: [],
    riskMandate,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

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
  const resources: Record<string, unknown> = {};
  for (const acc of opts.accounts ?? []) {
    resources[`accounts/${acc.accountId}`] = acc;
  }
  const result = await testBlock(seedSession, {
    input: { ...baseInput, ...opts.input },
    flow,
    user: { resources },
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
