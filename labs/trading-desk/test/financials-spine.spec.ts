/**
 * Tests for the financials data spine (FIX-758 rescope).
 *
 * Intent encoded: the subject's financial payloads are fetched once into a
 * session-scoped resource and the valuation tap reads that stable copy — there
 * is no process TTL cache in this path anymore.
 *
 *   1. The four financials tools (fundamentals + three statements) write their
 *      payload through `getOrPatchState` into the `financialsData` resource.
 *   2. `computeAndStoreSpine` reads those payloads back off `financialsData`
 *      (not a warm cache) and produces the `valuationSpine`.
 *
 * Driven through `testFlow` against an in-memory store — the tools run as steps
 * to populate the spine, then the tap runs — and both persisted resources are
 * read back via `stores.resourceState.getAll`, the same inspection path the
 * price-history and past-reports specs use.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { createInMemoryStores } from "@flow-state-dev/server";
import { testFlow } from "@flow-state-dev/testing";
import { get_fundamentals } from "../src/flows/analysis/tools/data/get_fundamentals";
import { get_balance_sheet } from "../src/flows/analysis/tools/data/get_balance_sheet";
import { get_income_statement } from "../src/flows/analysis/tools/data/get_income_statement";
import { get_cashflow } from "../src/flows/analysis/tools/data/get_cashflow";
import { computeAndStoreSpine } from "../src/flows/analysis/compute-spine";
import { seedSession } from "../src/flows/analysis/orchestration/guards";
import { financialsDataResource } from "../src/flows/analysis/financials-data-resource";
import { valuationSpineResource } from "../src/flows/analysis/valuation-spine-resource";
import { sessionStateSchema } from "../src/flows/analysis/state";

// Fetch the four financials into the spine, then compute the valuation off it.
// The tools run in `.parallel` — exactly how the fundamentals analyst fans them
// out — so all four patch the shared `financialsData` resource concurrently.
// Per-resource write serialization must keep every field; without it the
// read-modify-write patches clobber each other and compute-spine sees nulls.
const fillFinancials = sequencer({
  name: "fill-financials",
  inputSchema: z.object({ ticker: z.string(), date: z.string() }),
})
  .parallel({
    fundamentals: get_fundamentals,
    balanceSheet: get_balance_sheet,
    incomeStatement: get_income_statement,
    cashflow: get_cashflow,
  })
  .step(computeAndStoreSpine);

const spineFlow = defineFlow({
  kind: "trading-desk-financials-spine-test",
  actions: {
    fillAndCompute: { block: fillFinancials },
    seed: { block: seedSession },
  },
  session: { stateSchema: sessionStateSchema },
  resources: {
    financialsData: financialsDataResource,
    valuationSpine: valuationSpineResource,
  },
})({ id: "test" });

const seedInput = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  userThesis: null,
  userThesisRationale: null,
  selectedAccountIds: [] as string[],
  riskMandate: null,
};

const baseState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-1" as const,
  maxDebateRounds: 1,
  runComplete: false,
};

describe("financials data spine", () => {
  it("parallel tools write all four payloads into financialsData without clobber; the tap reads them to build valuationSpine", async () => {
    const stores = createInMemoryStores();
    const sessionId = "financials-spine-fixture";

    const result = await testFlow({
      flow: spineFlow,
      action: "fillAndCompute",
      userId: "test-user",
      sessionId,
      stores,
      input: { ticker: "NVDA", date: "2026-05-06" },
      seed: { session: { state: baseState } },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const resources = await stores.resourceState.getAll("session", sessionId);

    // 1. Each tool wrote its payload into the spine (one named field per tool).
    const financials = resources["financialsData"] as Record<string, unknown> | undefined;
    expect(financials).toBeTruthy();
    expect(financials?.fundamentals).toBeTruthy();
    expect(financials?.balanceSheet).toBeTruthy();
    expect(financials?.incomeStatement).toBeTruthy();
    expect(financials?.cashflow).toBeTruthy();

    // 2. The tap read those off the spine (not a warm cache) and produced the
    //    valuation spine for the same subject.
    const spine = resources["valuationSpine"] as { ticker?: string; envelope?: unknown } | null | undefined;
    expect(spine).toBeTruthy();
    expect(spine?.ticker).toBe("NVDA");
    expect(spine?.envelope).toBeTruthy();
  });

  it("seedSession resets financialsData so a re-run refetches instead of reusing stale payloads", async () => {
    const stores = createInMemoryStores();
    const sessionId = "financials-rerun";

    // First run populates the spine through the real path (valid fixture data).
    const first = await testFlow({
      flow: spineFlow,
      action: "fillAndCompute",
      userId: "test-user",
      sessionId,
      stores,
      input: { ticker: "NVDA", date: "2026-05-06" },
      seed: { session: { state: baseState } },
    });
    expect(first.error).toBeUndefined();
    const afterFill = await stores.resourceState.getAll("session", sessionId);
    expect((afterFill["financialsData"] as Record<string, unknown>)?.fundamentals).toBeTruthy();

    // Re-running the analysis on the same session seeds first — which must clear
    // the spine so the Phase 1 tools refetch rather than treat the prior run's
    // payloads as hits (the old TTL cache aged out; the spine does not).
    const second = await testFlow({
      flow: spineFlow,
      action: "seed",
      userId: "test-user",
      sessionId,
      stores,
      input: seedInput,
    });
    expect(second.error).toBeUndefined();

    const afterSeed = await stores.resourceState.getAll("session", sessionId);
    expect(afterSeed["financialsData"]).toEqual({});
  });
});
