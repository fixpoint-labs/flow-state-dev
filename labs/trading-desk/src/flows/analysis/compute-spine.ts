/**
 * Post-Phase-1 tap: computes the valuation spine from the session data spine
 * and writes it to the session-scoped `valuationSpineResource`.
 *
 * Every input — the four financials, the two quant payloads, the technical
 * indicators, and the company profile — is read from the per-domain session
 * spine resources the Phase 1 tools wrote via `getOrPatchState`. No re-fetch, no
 * `block.run()`, and no dependence on a warm process cache: this tap reads the
 * stable per-session copy.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { computeValuation } from "./lib/valuation";
import { buildValuationSpine } from "./lib/valuation-spine";
import { valuationSpineResource } from "./valuation-spine-resource";
import { financialsDataResource } from "./financials-data-resource";
import { quantDataResource } from "./quant-data-resource";
import { technicalDataResource } from "./technical-data-resource";
import { profileDataResource } from "./profile-data-resource";
import { sessionStateSchema } from "./state";

export const computeAndStoreSpine = handler({
  name: "compute-valuation-spine",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: {
    valuationSpine: valuationSpineResource,
    financialsData: financialsDataResource,
    quantData: quantDataResource,
    technicalData: technicalDataResource,
    profileData: profileDataResource,
  },
  execute: async (_input, ctx) => {
    const { ticker, date } = ctx.session.state;

    // Read every input off the per-domain session spines the Phase 1 tools
    // populated. No warm-cache dependency.
    const fin = ctx.resources.financialsData.state;
    const quant = ctx.resources.quantData.state;
    const tech = ctx.resources.technicalData.state;
    const profile = ctx.resources.profileData.state;

    const fundamentals = (fin.fundamentals ?? null) as any;
    const balanceSheet = (fin.balanceSheet ?? null) as any;
    const incomeStatement = (fin.incomeStatement ?? null) as any;
    const cashflow = (fin.cashflow ?? null) as any;
    const quantComposites = (quant.quantComposites ?? null) as any;
    const factorRanks = (quant.factorRanks ?? null) as any;
    const indicators = (tech.indicators ?? null) as any;
    const companyProfile = (profile.companyProfile ?? null) as any;

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
      quantComposites,
      factorRanks,
      technicals: indicators,
      valuation,
    });

    await ctx.resources.valuationSpine.patchState(spine);
  },
});
