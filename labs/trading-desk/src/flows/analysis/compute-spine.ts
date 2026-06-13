/**
 * Post-Phase-1 tap: computes the valuation spine from cached tool payloads
 * and writes it to the session-scoped `valuationSpineResource`.
 *
 * Reads from the same shared tool-fetch cache (`ctx.cap.cache`, the
 * `analysisCache` capability) the Phase 1 tools populated — no extra network
 * calls in live mode, no block.run() calls. In fixture mode reads directly
 * from `loadFixture`.
 */
import { handler } from "@flow-state-dev/core";
import type { CachedFetchAccessor } from "@flow-state-dev/patterns";
import { z } from "zod";
import { analysisCache } from "../shared/cache-capability";
import { loadFixture } from "./tools/runtime/fixtures";
import type { ToolName } from "./tools/schemas";
import { computeValuation } from "./lib/valuation";
import { buildValuationSpine } from "./lib/valuation-spine";
import { valuationSpineResource } from "./valuation-spine-resource";
import { sessionStateSchema } from "./state";

function pickMode(state: { dataSource: string }): "fixture" | "live" {
  return state.dataSource === "fixture" ? "fixture" : "live";
}

async function loadPayload<T>(
  cache: CachedFetchAccessor,
  tool: ToolName,
  args: { ticker: string; date: string },
  mode: "fixture" | "live",
): Promise<T | null> {
  try {
    if (mode === "fixture") {
      return loadFixture(tool, args) as unknown as T;
    }
    return await cache.getOrFetch(tool, args, async () => {
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
  resources: { valuationSpine: valuationSpineResource },
  uses: [analysisCache],
  execute: async (_input, ctx) => {
    const { ticker, date, dataSource } = ctx.session.state;
    const mode = pickMode({ dataSource });
    const args = { ticker, date };
    const cache = ctx.cap.cache;

    const [fundamentals, balanceSheet, incomeStatement, cashflow, quantComposites, factorRanks, indicators, companyProfile] =
      await Promise.all([
        loadPayload<any>(cache, "get_fundamentals", args, mode),
        loadPayload<any>(cache, "get_balance_sheet", args, mode),
        loadPayload<any>(cache, "get_income_statement", args, mode),
        loadPayload<any>(cache, "get_cashflow", args, mode),
        loadPayload<any>(cache, "get_quant_composites", args, mode),
        loadPayload<any>(cache, "get_factor_ranks", args, mode),
        loadPayload<any>(cache, "compute_indicators", args, mode),
        loadPayload<any>(cache, "get_company_profile", args, mode),
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
