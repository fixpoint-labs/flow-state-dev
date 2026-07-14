/**
 * The `portfolio` flow definition.
 *
 * This flow holds the genuinely flow-shaped portfolio work: `extractHoldingsFromPdf`
 * (an LLM generator that streams and writes the `pdfImport` scratch) and the
 * per-position thesis writes `saveThesis` / `deleteThesis` (FIX-760). The account
 * / holdings / ledger CRUD and the quote refresh, by contrast, are basic domain
 * work over the app-owned tables (FIX-772/FIX-823) that live in plain REST routes
 * (`app/api/portfolio/*`) — a flow buys them nothing and costs a request-envelope
 * return and a bound-session requirement (FIX-736 follow-up; the write logic is
 * `src/domain/portfolio/services/portfolio-writes.ts`, and the quote refresh is
 * `refreshQuotes` in `get-quotes.ts` behind `POST /api/portfolio/quotes/refresh`).
 * A thesis is the exception that proves the boundary: it is a REACTIVE, cross-flow
 * resource (the client reads it live, the analysis flow reads + derives it), so
 * its writes are flow actions, not a route. This is the showcase boundary: flows
 * for agentic / streaming / cross-flow / reactive-resource work, routes for domain
 * CRUD.
 */
import { defineFlow } from "@flow-state-dev/core";
import { deleteThesis, saveThesis } from "./thesis-actions";
import { clearPortfolioMandate, savePortfolioMandate } from "./portfolio-mandate-actions";
import { extractHoldingsFromPdf } from "./extract-holdings-action";
import {
  pdfImportResource,
  portfolioMandateResource,
  thesesCollection,
} from "./portfolio-resources";
import { sessionStateSchema } from "./state";

export { sessionStateSchema, type SessionState } from "./state";

const portfolioFlow = defineFlow({
  kind: "portfolio",
  requireUser: true,

  actions: {
    // Thesis writes stay flow actions — unlike the account/holdings/ledger CRUD
    // that moved to REST routes, a thesis is a REACTIVE, cross-flow resource (the
    // client reads it live via `useResourceCollectionList`, and the analysis flow
    // reads + derives it), which is exactly the flow-shaped side of this boundary.
    saveThesis: { block: saveThesis },
    deleteThesis: { block: deleteThesis },
    // Durable portfolio mandate (FIX-761) — the household IPS. Like a thesis, the
    // mandate is a REACTIVE, cross-flow resource (the client reads it live, the
    // analysis flow reads it at seed), so its writes are flow actions, not routes.
    savePortfolioMandate: { block: savePortfolioMandate },
    clearPortfolioMandate: { block: clearPortfolioMandate },
    extractHoldingsFromPdf: { block: extractHoldingsFromPdf },
  },

  session: { stateSchema: sessionStateSchema },

  resources: {
    // Transient per-session PDF-extraction channel written by
    // `extractHoldingsFromPdf`; the import dialog reads it via `useResource`.
    // Accounts, holdings, and last-known prices are not resources — they live in
    // the app-owned tables (FIX-772/FIX-823); the refresh route upserts `app.quotes`.
    pdfImport: pdfImportResource,
    // Per-position thesis records (FIX-760) — user-scoped collection
    // (`theses/{ticker}`, flowIsolation:false → cross-flow). Written by
    // saveThesis/deleteThesis here and adoptThesis in the analysis flow; read by
    // the analysis seed and the Portfolio/report UI.
    theses: thesesCollection,
    // Durable household portfolio mandate (FIX-761) — user-scoped single resource
    // (`flowIsolation: false` → cross-flow). Written by save/clearPortfolioMandate
    // here; read by the analysis seed and the Portfolio UI editor.
    portfolioMandate: portfolioMandateResource,
  },
});

const flow = portfolioFlow({ id: "default" });

export default flow;
