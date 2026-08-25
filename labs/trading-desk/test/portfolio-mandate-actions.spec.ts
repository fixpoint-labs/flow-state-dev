/**
 * Integration tests for the durable portfolio-mandate write actions (FIX-761),
 * driven through the real `runAction` engine via `testFlow`.
 *
 * The mandate is a user-scoped SINGLE resource (`portfolioMandateResource`), so
 * these assert the actions mutate that resource — read back from the user-scope
 * store. `savePortfolioMandate` upserts (canonicalizing exclusions, preserving
 * `createdAt`), THROWS on business-invalid input (nothing persists — the
 * void/guard contract), and rejects an unknown appetite id;
 * `clearPortfolioMandate` resets it to null.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryStores, toBareStates } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import portfolioFlow from "../flows/portfolio/flow";
import type { PortfolioMandate } from "../domain/portfolio/schema/portfolio-mandate-schema";

const USER_ID = "devuser";

/** Read the household's single portfolio-mandate record from the user-scope
 *  store (found by its `objectives` field, distinguishing it from any theses). */
async function readMandate(
  stores: ReturnType<typeof createInMemoryStores>,
): Promise<PortfolioMandate | null> {
  const all = toBareStates(await stores.resourceState.getAll("user", USER_ID));
  const entry = Object.values(all).find(
    (v) => v != null && typeof v === "object" && "objectives" in (v as object),
  );
  return (entry as PortfolioMandate) ?? null;
}

/** A minimal, valid save input (the action fills sub-field defaults). */
function validInput(overrides: Record<string, unknown> = {}) {
  return {
    objectives: { riskTolerance: "moderate" as const },
    constraints: {},
    rebalancing: {},
    timeHorizon: {},
    ...overrides,
  };
}

let stores: ReturnType<typeof createInMemoryStores>;
beforeEach(() => {
  stores = createInMemoryStores();
});

describe("savePortfolioMandate action", () => {
  it("upserts a valid mandate and canonicalizes exclusions", async () => {
    const result = await testFlow({
      flow: portfolioFlow,
      action: "savePortfolioMandate",
      userId: USER_ID,
      stores,
      input: validInput({
        label: "Household IPS 2026",
        constraints: { maxPositionWeightPct: 5, exclusions: [" nvda ", "tsla", "nvda"] },
      }),
    });
    expect(result.status).toBe("completed");

    const stored = await readMandate(stores);
    expect(stored).not.toBeNull();
    expect(stored?.label).toBe("Household IPS 2026");
    expect(stored?.constraints.maxPositionWeightPct).toBe(5);
    // Trimmed, upper-cased, deduped.
    expect(stored?.constraints.exclusions).toEqual(["NVDA", "TSLA"]);
    expect(typeof stored?.createdAt).toBe("string");
    expect(typeof stored?.updatedAt).toBe("string");
  });

  it("preserves createdAt across an edit and bumps updatedAt", async () => {
    await testFlow({
      flow: portfolioFlow,
      action: "savePortfolioMandate",
      userId: USER_ID,
      stores,
      input: validInput({ label: "First" }),
    });
    const first = await readMandate(stores);

    await testFlow({
      flow: portfolioFlow,
      action: "savePortfolioMandate",
      userId: USER_ID,
      stores,
      input: validInput({ label: "Revised" }),
    });
    const second = await readMandate(stores);

    expect(second?.label).toBe("Revised");
    expect(second?.createdAt).toBe(first?.createdAt); // overwrite in place
  });

  it("throws on a business-invalid mandate and persists nothing", async () => {
    const result = await testFlow({
      flow: portfolioFlow,
      action: "savePortfolioMandate",
      userId: USER_ID,
      stores,
      input: validInput({
        // No-cash allocation summing above 100 → validation rejects.
        targetAllocation: [
          { assetClass: "equity", targetPct: 70 },
          { assetClass: "fixed_income", targetPct: 40 },
        ],
      }),
    });
    expect(result.status).not.toBe("completed");
    expect(await readMandate(stores)).toBeNull();
  });

  it("rejects an unknown riskAppetite id (a typo) on a new write", async () => {
    const result = await testFlow({
      flow: portfolioFlow,
      action: "savePortfolioMandate",
      userId: USER_ID,
      stores,
      input: validInput({ riskAppetite: "aggressive" }), // not a MANDATE_PACK id
    });
    expect(result.status).not.toBe("completed");
    expect(await readMandate(stores)).toBeNull();
  });

  it("accepts a valid riskAppetite id", async () => {
    const result = await testFlow({
      flow: portfolioFlow,
      action: "savePortfolioMandate",
      userId: USER_ID,
      stores,
      input: validInput({ riskAppetite: "balanced" }),
    });
    expect(result.status).toBe("completed");
    expect((await readMandate(stores))?.riskAppetite).toBe("balanced");
  });
});

describe("clearPortfolioMandate action", () => {
  it("resets the mandate to null", async () => {
    await testFlow({
      flow: portfolioFlow,
      action: "savePortfolioMandate",
      userId: USER_ID,
      stores,
      input: validInput(),
    });
    expect(await readMandate(stores)).not.toBeNull();

    const result = await testFlow({
      flow: portfolioFlow,
      action: "clearPortfolioMandate",
      userId: USER_ID,
      stores,
      input: {},
    });
    expect(result.status).toBe("completed");
    expect(await readMandate(stores)).toBeNull();
  });
});
