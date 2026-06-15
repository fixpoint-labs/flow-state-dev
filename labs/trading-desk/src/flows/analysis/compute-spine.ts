/**
 * Post-Phase-1 tap: computes the valuation spine from cached tool payloads
 * and writes it to the session-scoped `valuationSpineResource`.
 *
 * Reads from the same process cache (`getOrFetch`) the Phase 1 tools
 * populated — no extra network calls in live mode, no block.run() calls.
 * In fixture mode reads directly from `loadFixture`.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { getOrFetch } from "./tools/runtime/cache";
import { loadFixture } from "./tools/runtime/fixtures";
import type { ToolName } from "./tools/schemas";
import { computeValuation } from "./lib/valuation";
import { buildValuationSpine } from "./lib/valuation-spine";
import { valuationSpineResource } from "./valuation-spine-resource";
import { financialsDataResource } from "./financials-data-resource";
import { sessionStateSchema } from "./state";

function pickMode(state: { dataSource: string }): "fixture" | "live" {
  return state.dataSource === "fixture" ? "fixture" : "live";
}

async function loadPayload<T>(
  tool: ToolName,
  args: { ticker: string; date: string },
  mode: "fixture" | "live",
): Promise<T | null> {
  try {
    if (mode === "fixture") {
      return loadFixture(tool, args) as unknown as T;
    }
    return await getOrFetch(tool, args, async () => {
      throw new Error(`cache miss for ${tool} — expected warm cache after Phase 1`);
    }) as T;
  } catch {
    return null;
  }
}

export const computeAndStoreSpine = handler({
  name: "compute-valuation-spine",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: { valuationSpine: valuationSpineResource, financialsData: financialsDataResource },
  execute: async (_input, ctx) => {
    const { ticker, date, dataSource } = ctx.session.state;
    const mode = pickMode({ dataSource });
    const args = { ticker, date };

    // The four financials payloads are read from the session financials spine —
    // the fundamentals analyst's tools wrote them there in Phase 1. No re-fetch,
    // no dependence on a warm process cache: this tap reads the stable copy.
    const fin = ctx.resources.financialsData.state;
    const fundamentals = (fin.fundamentals ?? null) as any;
    const balanceSheet = (fin.balanceSheet ?? null) as any;
    const incomeStatement = (fin.incomeStatement ?? null) as any;
    const cashflow = (fin.cashflow ?? null) as any;

    const [quantComposites, factorRanks, indicators, companyProfile] =
      await Promise.all([
        loadPayload<any>("get_quant_composites", args, mode),
        loadPayload<any>("get_factor_ranks", args, mode),
        loadPayload<any>("compute_indicators", args, mode),
        loadPayload<any>("get_company_profile", args, mode),
      ]);

    if (!fundamentals || !balanceSheet || !incomeStatement || !cashflow) {
      return;
    }

    const valuation = computeValuation({
      fundamentals,
      balanceSheet,
      incomeStatement,
      cashflow,
    });

    const sector = companyProfile?.sector ?? null;

    const spine = buildValuationSpine({
      ticker,
      asOf: date,
      fundamentals,
      balanceSheet,
      incomeStatement,
      cashflow,
      sector,
      quantComposites: quantComposites ?? null,
      factorRanks: factorRanks ?? null,
      technicals: indicators ?? null,
      valuation,
    });

    await ctx.resources.valuationSpine.patchState(spine);
  },
});
