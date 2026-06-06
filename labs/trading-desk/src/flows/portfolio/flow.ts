/**
 * The `portfolio` flow definition.
 *
 * The portfolio domain (Spine B) is the system of record for what the user
 * owns and the write surface for it: the account/holdings mutations, the price
 * fetch, and the PDF-import extraction. Its resources are user-scoped shared
 * (`flowIsolation: false` → bare `{userId}`), so the report flow
 * (`trading-desk`) reads the same `accounts` + `portfolioQuotes` at seed without
 * a client bridge. This is the bare `defineFlow` contract — actions, resources,
 * and the (empty) session-state shape.
 */
import { defineFlow } from "@flow-state-dev/core";
import {
  deleteAccount,
  deleteHolding,
  importHoldings,
  saveAccount,
} from "./portfolio-actions";
import { getQuotes } from "./get-quotes";
import { extractHoldingsFromPdf } from "./extract-holdings-action";
import {
  accountsCollection,
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
    getQuotes: { block: getQuotes },
    extractHoldingsFromPdf: { block: extractHoldingsFromPdf },
  },

  session: { stateSchema: sessionStateSchema },

  resources: {
    // The system of record — one user-scoped collection keyed by accountId
    // (flowIsolation: false → bare `{userId}`, shared across flows). Holdings
    // live inline in each account record.
    accounts: accountsCollection,
    // User-scoped per-user last-known-quotes cache written by `getQuotes`
    // (readable cross-flow by the report flow at seed).
    portfolioQuotes: portfolioQuotesResource,
    // Transient per-session PDF-extraction channel written by
    // `extractHoldingsFromPdf`; the import dialog reads it via `useResource`.
    pdfImport: pdfImportResource,
  },
});

const flow = portfolioFlow({ id: "default" });

export default flow;
