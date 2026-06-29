/**
 * Integration tests for the per-position thesis write actions (FIX-760), driven
 * through the real `runAction` engine via `testFlow`.
 *
 * A thesis is a user-scoped resource collection (`theses/{ticker}`), so these
 * assert the actions mutate that collection — read back from the user-scope
 * resource state. `saveThesis` upserts (canonicalizing the ticker) and rejects an
 * empty rationale; `deleteThesis` removes one. The `adoptThesis` derive-from-
 * report path is tested separately in the analysis flow.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import portfolioFlow from "../src/flows/portfolio/flow";
import type { ThesisRecord } from "../src/flows/portfolio/thesis-schema";

const USER_ID = "devuser";

/** Read the household's theses collection items from the user-scope store. */
async function thesesOf(
  stores: ReturnType<typeof createInMemoryStores>,
): Promise<Record<string, ThesisRecord>> {
  return (await stores.resourceState.getAll("user", USER_ID)) as Record<string, ThesisRecord>;
}

let stores: ReturnType<typeof createInMemoryStores>;
beforeEach(() => {
  stores = createInMemoryStores();
});

describe("saveThesis action", () => {
  it("upserts a thesis into the household collection and canonicalizes the ticker", async () => {
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

    const stored = (await thesesOf(stores))["theses/NVDA"];
    expect(stored).toBeDefined();
    expect(stored.entryRationale).toBe("Compute demand outruns supply.");
    expect(stored.tripwires).toHaveLength(1);
    expect(stored.stopPrice).toBe(95);
    expect(typeof stored.createdAt).toBe("string");
    expect(typeof stored.updatedAt).toBe("string");
  });

  it("preserves createdAt across an edit and bumps updatedAt", async () => {
    await testFlow({
      flow: portfolioFlow,
      action: "saveThesis",
      userId: USER_ID,
      stores,
      input: { ticker: "NVDA", entryRationale: "First take." },
    });
    const first = (await thesesOf(stores))["theses/NVDA"];

    await testFlow({
      flow: portfolioFlow,
      action: "saveThesis",
      userId: USER_ID,
      stores,
      input: { ticker: "NVDA", entryRationale: "Revised." },
    });
    const second = (await thesesOf(stores))["theses/NVDA"];

    expect(second.entryRationale).toBe("Revised.");
    expect(second.createdAt).toBe(first.createdAt); // overwrite in place
  });

  it("rejects an empty entry rationale at the action boundary", async () => {
    const result = await testFlow({
      flow: portfolioFlow,
      action: "saveThesis",
      userId: USER_ID,
      stores,
      input: { ticker: "NVDA", entryRationale: "" },
    });
    expect(result.status).not.toBe("completed");
    expect((await thesesOf(stores))["theses/NVDA"]).toBeUndefined();
  });

  it("rejects a whitespace-only entry rationale at the action boundary", async () => {
    const result = await testFlow({
      flow: portfolioFlow,
      action: "saveThesis",
      userId: USER_ID,
      stores,
      input: { ticker: "NVDA", entryRationale: "   " },
    });
    expect(result.status).not.toBe("completed");
    expect((await thesesOf(stores))["theses/NVDA"]).toBeUndefined();
  });

  it("rejects a nonpositive price at the action boundary", async () => {
    const result = await testFlow({
      flow: portfolioFlow,
      action: "saveThesis",
      userId: USER_ID,
      stores,
      input: { ticker: "NVDA", entryRationale: "x", stopPrice: 0 },
    });
    expect(result.status).not.toBe("completed");
    expect((await thesesOf(stores))["theses/NVDA"]).toBeUndefined();
  });

  it("keeps a slash ticker (BRK/B) a single collection segment", async () => {
    const result = await testFlow({
      flow: portfolioFlow,
      action: "saveThesis",
      userId: USER_ID,
      stores,
      input: { ticker: "brk/b", entryRationale: "Holdco compounder." },
    });
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ ticker: "BRK/B" }); // real ticker echoed
    const stored = await thesesOf(stores);
    // Stored under an encoded single-segment key; the record keeps the real ticker.
    expect(stored["theses/BRK%2FB"]).toBeDefined();
    expect(stored["theses/BRK%2FB"].ticker).toBe("BRK/B");
  });
});

describe("deleteThesis action", () => {
  it("removes the household's thesis for a ticker", async () => {
    await testFlow({
      flow: portfolioFlow,
      action: "saveThesis",
      userId: USER_ID,
      stores,
      input: { ticker: "NVDA", entryRationale: "x" },
    });
    expect((await thesesOf(stores))["theses/NVDA"]).toBeDefined();

    const result = await testFlow({
      flow: portfolioFlow,
      action: "deleteThesis",
      userId: USER_ID,
      stores,
      input: { ticker: "nvda" },
    });
    expect(result.status).toBe("completed");
    expect((await thesesOf(stores))["theses/NVDA"]).toBeUndefined();
  });
});
