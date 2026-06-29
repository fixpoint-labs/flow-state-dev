/**
 * Integration tests for the per-position thesis write actions (FIX-760), driven
 * through the real `runAction` engine via `testFlow`.
 *
 * These lock the portfolio-UI editing path: `saveThesis` upserts through the
 * repository at the caller's household scope and canonicalizes the ticker;
 * `deleteThesis` removes one; and `saveThesis` rejects an empty rationale at the
 * action boundary (a thesis with no "why" is meaningless). The `adoptThesis`
 * derive-from-report path is tested separately in the analysis flow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { makeTestRepository } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/src/db/repository";

const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import portfolioFlow from "../src/flows/portfolio/flow";

const USER_ID = "devuser";

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
});

describe("saveThesis action", () => {
  it("upserts a thesis at the caller household and canonicalizes the ticker", async () => {
    const stores = createInMemoryStores();
    const result = await testFlow({
      flow: portfolioFlow,
      action: "saveThesis",
      userId: USER_ID,
      stores,
      input: {
        ticker: " nvda ",
        entryRationale: "Compute demand outruns supply.",
        tripwires: [{ kind: "price", note: "stop", level: 95, byDate: null }],
        timeHorizon: "quarters",
        stopPrice: 95,
      },
    });
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ ticker: "NVDA" });

    const stored = await repoState.repo!.getThesis(USER_ID, "NVDA");
    expect(stored?.entryRationale).toBe("Compute demand outruns supply.");
    expect(stored?.tripwires).toHaveLength(1);
    expect(stored?.stopPrice).toBe(95);
  });

  it("rejects an empty entry rationale at the action boundary", async () => {
    const stores = createInMemoryStores();
    const result = await testFlow({
      flow: portfolioFlow,
      action: "saveThesis",
      userId: USER_ID,
      stores,
      input: { ticker: "NVDA", entryRationale: "" },
    });
    expect(result.status).not.toBe("completed");
    expect(await repoState.repo!.getThesis(USER_ID, "NVDA")).toBeNull();
  });
});

describe("deleteThesis action", () => {
  it("removes the household's thesis for a ticker", async () => {
    const stores = createInMemoryStores();
    await repoState.repo!.upsertThesis({
      userId: USER_ID,
      ticker: "NVDA",
      entryRationale: "x",
      invalidationConditions: null,
      tripwires: [],
      timeHorizon: null,
      targetPrice: null,
      stopPrice: null,
      sourceSessionId: null,
    });

    const result = await testFlow({
      flow: portfolioFlow,
      action: "deleteThesis",
      userId: USER_ID,
      stores,
      input: { ticker: "nvda" },
    });
    expect(result.status).toBe("completed");
    expect(await repoState.repo!.getThesis(USER_ID, "NVDA")).toBeNull();
  });
});
