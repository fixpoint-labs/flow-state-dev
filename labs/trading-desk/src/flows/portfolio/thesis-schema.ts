/**
 * Pure, browser-safe per-position thesis schemas (FIX-760).
 *
 * A *thesis* is the durable "why" attached to a position: the entry rationale,
 * the conditions that would prove it wrong, a time horizon, and an optional link
 * back to the analysis report it came from. It is keyed household × ticker — one
 * thesis per name regardless of which account holds it (intent is about the name;
 * account location is a tax question). Like accounts/holdings/ledger it lives in
 * the app-owned relational layer (FIX-772), NOT an FSD resource; this leaf is the
 * shared shape the editor validates client-side, the action re-validates
 * server-side, and the repository maps rows to (BP-019: imports only `zod`, no
 * `@flow-state-dev/core`, so it stays bundle-safe).
 *
 * `invalidationConditions` is freeform prose; `tripwires` are the optional
 * structured, observable falsifiers (a price level, a dated event) the future
 * review loop (FIX-763) checks mechanically. Freeform is what users write;
 * tripwires are what a machine can check — the thesis carries both.
 *
 * These are NOT generator output schemas — `.default()` / `.nullable()` are fine
 * (BP-016 only constrains generator outputs); do not add them to
 * `output-schemas-strict.spec.ts`.
 */
import { z } from "zod";

/** What kind of observable a tripwire watches: a price level, a named event, or
 *  a calendar date. Stored inside the `tripwires` jsonb column (enum enforced
 *  here at the boundary), so adding a kind later needs no migration. */
export const tripwireKindSchema = z.enum(["price", "event", "date"]);
export type TripwireKind = z.infer<typeof tripwireKindSchema>;

/** An ISO `YYYY-MM-DD` calendar date — validated at the boundary so a typo fails
 *  here with a clear message, not as a cryptic driver error (the ledger precedent). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date YYYY-MM-DD");

/**
 * One observable falsifier — the "wrong if [observable]" clause behind an
 * auditable thesis. `note` is the human-readable observable ("Q3 ad-tier ARPU
 * prints below $8"); `level` carries the price for a `price` tripwire; `byDate`
 * carries the deadline for a `date`/`event` tripwire. Both are nullable so a
 * tripwire can be specified before its number/date is known — the review loop
 * skips a level-less / date-less tripwire rather than erroring.
 */
export const tripwireSchema = z.object({
  kind: tripwireKindSchema,
  note: z.string().min(1).max(300),
  // A price tripwire's level is a price, so reject zero/negative (a nonsensical
  // level would pollute the `<standingThesis>` prompt). Null for non-price kinds.
  level: z.number().positive().finite().nullable().default(null),
  byDate: isoDate.nullable().default(null),
});
export type Tripwire = z.infer<typeof tripwireSchema>;

/** The position's intended holding horizon. */
export const timeHorizonSchema = z.enum(["days", "weeks", "months", "quarters", "years"]);
export type TimeHorizon = z.infer<typeof timeHorizonSchema>;

/**
 * The user-suppliable thesis fields — what the editor sends, what `adoptThesis`
 * derives. `ticker` is the household × ticker key (the `userId` half is resolved
 * server-side from the caller identity, never trusted from the client); the
 * repository owns the timestamps. `entryRationale` is required and non-empty — a
 * thesis with no "why" is meaningless. `sourceSessionId` links the originating
 * analysis report (null for a hand-written thesis).
 */
export const thesisInputSchema = z.object({
  ticker: z.string().min(1).max(12),
  // `.trim()` first so a whitespace-only rationale (a direct/bypass caller) fails
  // `.min(1)` — the formatter only suppresses an exactly empty string, so a blank
  // "why" must never persist into the `<standingThesis>` prompt.
  entryRationale: z.string().trim().min(1).max(4000),
  invalidationConditions: z.string().max(4000).nullable().default(null),
  tripwires: z.array(tripwireSchema).max(20).default([]),
  timeHorizon: timeHorizonSchema.nullable().default(null),
  // Prices, so reject zero/negative at the boundary (a nonsensical level would
  // persist into the standing-thesis card + the trader/PM prompt context).
  targetPrice: z.number().positive().finite().nullable().default(null),
  stopPrice: z.number().positive().finite().nullable().default(null),
  sourceSessionId: z.string().nullable().default(null),
});
export type ThesisInputFields = z.infer<typeof thesisInputSchema>;

/**
 * The persisted-and-mapped read shape the repository returns and the standing-
 * thesis context injection consumes. Adds the repository-owned timestamps to the
 * input fields; numerics are coerced to JS `number` and timestamps to ISO-8601 at
 * the read boundary (the FIX-772 `mapHolding` precedent).
 */
export const thesisRecordSchema = thesisInputSchema.extend({
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ThesisRecord = z.infer<typeof thesisRecordSchema>;
