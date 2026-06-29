/**
 * The `portfolio` flow definition.
 *
 * The portfolio domain (Spine B) is the system of record for what the user
 * owns and the write surface for it: the account/holdings mutations, the price
 * fetch, and the PDF-import extraction. Accounts + holdings live in the
 * app-owned relational tables (FIX-772); the write actions reach them via the
 * repository. The remaining resources are user-scoped shared
 * (`flowIsolation: false` → bare `{userId}`): the `portfolioQuotes` cache the
 * analysis flow reads at seed, and the per-session `pdfImport` scratch. This is
 * the bare `defineFlow` contract — actions, resources, and the (empty)
 * session-state shape.
 */
import { defineFlow } from "@flow-state-dev/core";
import {
  deleteAccount,
  deleteHolding,
  importHoldings,
  recordLedgerEvent,
  saveAccount,
} from "./portfolio-actions";
import { deleteThesis, saveThesis } from "./thesis-actions";
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
    saveAccount: { block: saveAccount },
    deleteAccount: { block: deleteAccount },
    importHoldings: { block: importHoldings },
    deleteHolding: { block: deleteHolding },
    recordLedgerEvent: { block: recordLedgerEvent },
    saveThesis: { block: saveThesis },
    deleteThesis: { block: deleteThesis },
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
