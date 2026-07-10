/**
 * The `portfolio` flow definition.
 *
 * This flow holds the genuinely flow-shaped portfolio work: `getQuotes`
 * (fetches live prices and upserts them into the durable `app.quotes` table the
 * analysis seed + Portfolio UI read, FIX-823), `extractHoldingsFromPdf` (an LLM generator that
 * streams and writes the `pdfImport` scratch), and the per-position thesis
 * writes `saveThesis` / `deleteThesis` (FIX-760). The account / holdings /
 * ledger CRUD, by contrast, is basic relational work over the app-owned tables
 * (FIX-772), which lives in plain REST routes (`app/api/portfolio/*`) — a flow
 * buys that CRUD nothing and costs it a request-envelope return and a
 * bound-session requirement (FIX-736 follow-up; the write logic is
 * `src/flows/portfolio/portfolio-writes.ts`). A thesis is the exception that
 * proves the boundary: it is a REACTIVE, cross-flow resource (the client reads
 * it live, the analysis flow reads + derives it), so its writes are flow
 * actions, not a route. This is the showcase boundary: flows for agentic /
 * streaming / cross-flow / reactive-resource work, routes for domain CRUD.
 */
import { defineFlow } from "@flow-state-dev/core";
import { deleteThesis, saveThesis } from "./thesis-actions";
import { getQuotes } from "./get-quotes";
import { extractHoldingsFromPdf } from "./extract-holdings-action";
import { pdfImportResource, thesesCollection } from "./portfolio-resources";
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
    getQuotes: { block: getQuotes },
    extractHoldingsFromPdf: { block: extractHoldingsFromPdf },
  },

  session: { stateSchema: sessionStateSchema },

  resources: {
    // Transient per-session PDF-extraction channel written by
    // `extractHoldingsFromPdf`; the import dialog reads it via `useResource`.
    // Accounts, holdings, and last-known prices are not resources — they live in
    // the app-owned tables (FIX-772/FIX-823); `getQuotes` upserts `app.quotes`.
    pdfImport: pdfImportResource,
    // Per-position thesis records (FIX-760) — user-scoped collection
    // (`theses/{ticker}`, flowIsolation:false → cross-flow). Written by
    // saveThesis/deleteThesis here and adoptThesis in the analysis flow; read by
    // the analysis seed and the Portfolio/report UI.
    theses: thesesCollection,
  },
});

const flow = portfolioFlow({ id: "default" });

export default flow;
