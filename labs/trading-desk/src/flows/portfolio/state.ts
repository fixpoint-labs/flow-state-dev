/**
 * Session-state contract for the `portfolio` flow.
 *
 * The portfolio domain is a system of record: every durable value lives in the
 * flow's RESOURCES (`accounts`, `portfolioQuotes`, `pdfImport`), not in session
 * state. Sessions on this flow are incidental — a binding for the user-scoped
 * resource reads — so the schema is empty. `defineFlow` still requires a
 * `session.stateSchema`, hence the empty object rather than no schema.
 */
import { z } from "zod";

export const sessionStateSchema = z.object({});

export type SessionState = z.infer<typeof sessionStateSchema>;
