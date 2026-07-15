/**
 * Session-state contract for the `portfolio` flow.
 *
 * The portfolio domain is a system of record: every durable value lives in the
 * app-owned tables (`app.accounts` / `app.holdings` / `app.quotes`, FIX-772/
 * FIX-823) or the flow's remaining resources (`pdfImport` scratch, the
 * `theses` collection), not in session state. Sessions on this flow are
 * incidental — a binding for the user-scoped resource reads — so the schema is
 * empty. `defineFlow` still requires a `session.stateSchema`, hence the empty
 * object rather than no schema.
 */
import { z } from "zod";

export const sessionStateSchema = z.object({});

export type SessionState = z.infer<typeof sessionStateSchema>;
