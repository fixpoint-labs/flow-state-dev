/**
 * The `portfolio` flow definition.
 *
 * This flow holds ONLY the genuinely flow-shaped portfolio work: `getQuotes`
 * (fetches live prices and writes the cross-flow `portfolioQuotes` resource the
 * analysis flow reads at seed) and `extractHoldingsFromPdf` (an LLM generator
 * that streams and writes the `pdfImport` scratch). Everything else the
 * portfolio domain needs is basic relational CRUD, which lives in plain REST
 * routes (`app/api/portfolio/*`) over the app-owned tables (FIX-772), NOT in
 * flow actions — a flow buys CRUD nothing and costs it a request-envelope
 * return and a bound-session requirement (FIX-736 follow-up; the write logic is
 * `src/flows/portfolio/portfolio-writes.ts`). This is the showcase boundary:
 * flows for agentic / streaming / cross-flow work, routes for domain CRUD.
 */
import { defineFlow } from "@flow-state-dev/core";
import { getQuotes } from "./get-quotes";
import { extractHoldingsFromPdf } from "./extract-holdings-action";
import {
  pdfImportResource,
  portfolioQuotesResource,
} from "./portfolio-resources";
import { sessionStateSchema } from "./state";

export { sessionStateSchema, type SessionState } from "./state";

const portfolioFlow = defineFlow({
  kind: "portfolio",
  requireUser: true,

  actions: {
    getQuotes: { block: getQuotes },
    extractHoldingsFromPdf: { block: extractHoldingsFromPdf },
  },

  session: { stateSchema: sessionStateSchema },

  resources: {
    // User-scoped per-user last-known-quotes cache written by `getQuotes`
    // (readable cross-flow by the report flow at seed). Accounts + holdings are
    // not resources — they live in the app-owned tables (FIX-772).
    portfolioQuotes: portfolioQuotesResource,
    // Transient per-session PDF-extraction channel written by
    // `extractHoldingsFromPdf`; the import dialog reads it via `useResource`.
    pdfImport: pdfImportResource,
  },
});

const flow = portfolioFlow({ id: "default" });

export default flow;
