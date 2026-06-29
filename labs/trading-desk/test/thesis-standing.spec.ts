/**
 * Standing per-position thesis injection (FIX-760).
 *
 * Two seams:
 *  1. `formatStandingThesis` (pure) renders the `<standingThesis>` inner content
 *     when a thesis is present and suppresses (returns null) when absent / empty
 *     — the BP-018 guard-on-required-field, the `formatPortfolioContext`
 *     precedent the framework uses to omit the tag.
 *  2. `seedSession` reads the household × ticker thesis from the repository and
 *     freezes it onto `state.standingThesis`; null when none is recorded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { formatStandingThesis } from "../src/flows/analysis/lib/format";
import type { ThesisRecord } from "../src/flows/portfolio/thesis-schema";
import { makeTestRepository, seedAccount } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/src/db/repository";

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

function record(overrides: Partial<ThesisRecord> = {}): ThesisRecord {
  return {
    ticker: "NVDA",
    entryRationale: "Data-center compute demand outruns supply.",
    invalidationConditions: "Gross margin compresses below 60%.",
    tripwires: [{ kind: "price", note: "stop", level: 95, byDate: null }],
    timeHorizon: "quarters",
    targetPrice: 200,
    stopPrice: 95,
    sourceSessionId: "sess-1",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatStandingThesis", () => {
  it("renders the rationale, levels, invalidation, and tripwires", () => {
    const out = formatStandingThesis(record());
    expect(out).not.toBeNull();
    expect(out).toContain("STANDING thesis");
    expect(out).toContain("Data-center compute demand outruns supply.");
    expect(out).toContain("Intended horizon: quarters.");
    expect(out).toContain("target ~$200");
    expect(out).toContain("stop ~$95");
    expect(out).toContain("Gross margin compresses below 60%.");
    expect(out).toContain("[price] stop (price 95)");
  });

  it("suppresses the tag (null) when no thesis / empty rationale", () => {
    expect(formatStandingThesis(null)).toBeNull();
    expect(formatStandingThesis(undefined)).toBeNull();
    // A nullable single resource that surfaced as `{}` must suppress, not throw.
    expect(formatStandingThesis({} as ThesisRecord)).toBeNull();
    expect(formatStandingThesis(record({ entryRationale: "" }))).toBeNull();
  });
});

const baseInput = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  userThesis: null,
  userThesisRationale: null,
  riskMandate: null,
  selectedAccountIds: [] as string[],
};

describe("seedSession standing thesis", () => {
  beforeEach(async () => {
    repoState.repo = await makeTestRepository();
  });

  it("freezes the household × ticker thesis onto state.standingThesis", async () => {
    await seedAccount(repoState.repo!, {
      accountId: "acc-1",
      userId: TEST_USER,
      name: "Taxable",
      type: "taxable",
      cashBalance: 1000,
      holdings: [{ ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null }],
    });
    await repoState.repo!.upsertThesis({
      userId: TEST_USER,
      ticker: "NVDA",
      entryRationale: "Held for the compute super-cycle.",
      invalidationConditions: null,
      tripwires: [],
      timeHorizon: "years",
      targetPrice: null,
      stopPrice: null,
      sourceSessionId: null,
    });

    const result = await testBlock(seedSession, { input: { ...baseInput }, flow });
    expect(result.error).toBeNull();
    const state = result.state.session as { standingThesis?: ThesisRecord | null };
    expect(state.standingThesis?.entryRationale).toBe("Held for the compute super-cycle.");
    expect(state.standingThesis?.timeHorizon).toBe("years");
  });

  it("sets standingThesis to null when no thesis is recorded for the ticker", async () => {
    const result = await testBlock(seedSession, { input: { ...baseInput }, flow });
    expect(result.error).toBeNull();
    const state = result.state.session as { standingThesis?: ThesisRecord | null };
    expect(state.standingThesis).toBeNull();
  });
});
