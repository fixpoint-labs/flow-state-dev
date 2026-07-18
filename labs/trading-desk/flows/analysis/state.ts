/**
 * Flow-level session state schema, lifted out of `flow.ts` so blocks can
 * reference it without creating an import cycle.
 *
 * `maxDebateRounds` caps the Phase 2 bull/bear loop. The cheap preset sets
 * it to 1 and the full preset to 2. The schema enforces the ceiling so
 * caller input cannot exceed it.
 *
 * `runComplete` flips to `true` when Phase 5 publishes the
 * `portfolioManager` memo, and is reset to `false` by `seedSession` at
 * the start of each run. Surfaced to the client so the status bar can
 * render a terminal "complete" state without inferring it from item counts.
 *
 * `stoppedReason` is the human-readable reason an `analyze` run was
 * aborted before producing a recommendation. Known causes:
 *   - `"unresolvable-ticker"` — the pre-flight guard could not resolve
 *      the ticker (missing fixture / all live providers unavailable).
 *   - `"unsupported-asset-type"` — the symbol classifies as an unambiguously
 *      non-equity instrument (a bond CUSIP / an OCC option / a `…-USD` crypto
 *      pair) the equity-only analyst bench cannot research. Stopped cleanly rather
 *      than hallucinating a stock report (the FIX-605 lesson, extended to asset
 *      type by FIX-773). Cash/money-market placeholders (`CASH`/`USD`) and other
 *      ticker-shaped symbols are NOT stopped — they pass to ticker resolution.
 *      ETF and crypto analysis are FIX-777's job, which widens this gate.
 *   - `"phase-1-missing-primary"` — the `fundamentals` OR `companyProfile`
 *      analyst errored. These two are non-substitutable, so phases 2–5
 *      would be synthesizing on hollow input even if other analysts succeeded.
 *   - `"phase-1-no-data"` — every Phase 1 analyst errored, so phases 2–5
 *      would be synthesizing on no upstream data (all-error backstop).
 * The full sentence (e.g. `"Could not resolve ticker ZZZ in fixture mode."`)
 * is stored in `stoppedMessage` for direct UI rendering. Both fields are
 * reset to `null` by `seedSession` at the start of each run.
 */
import { z } from "zod";
import { citationIntegritySchema } from "./resources";
import { portfolioContextInput } from "./flow-schema";
import { riskMandateSchema } from "./lib/risk-mandate";
import { thesisRecordSchema } from "@/domain/portfolio/schema/thesis-schema";
import { portfolioMandateSchema } from "@/domain/portfolio/schema/portfolio-mandate-schema";

export const sessionStateSchema = z.object({
  ticker: z.string().default("NVDA"),
  date: z.string().default("2026-05-06"),
  costPreset: z.enum(["fast", "full"]).default("fast"),
  dataSource: z.enum(["fixture", "live", "record"]).default("fixture"),
  activePhase: z
    .enum([
      "idle",
      "phase-1",
      "phase-2",
      "phase-3",
      "phase-4",
      "phase-5",
      "phase-6",
    ])
    .default("idle"),
  maxDebateRounds: z.number().int().min(1).max(2).default(1),
  runComplete: z.boolean().default(false),
  stoppedReason: z
    .enum([
      "unresolvable-ticker",
      "unsupported-asset-type",
      "phase-1-missing-primary",
      "phase-1-no-data",
    ])
    .nullable()
    .default(null),
  stoppedMessage: z.string().nullable().default(null),
  // Per-run user thesis, frozen at `seedSession`. The pipeline runs blind to
  // these — only the Phase 6 validator reads them via the `userThesis`
  // capability preset. A non-null `userThesis` gates the Phase 6 audit.
  userThesis: z.string().max(1500).nullable().default(null),
  userThesisRationale: z.string().max(1500).nullable().default(null),
  // Soft pre-flight warning surfaced when a thesis was provided but is too
  // short to audit meaningfully (< 20 chars). Not a halt — a sub-threshold
  // thesis is treated as no thesis and Phase 6 is skipped.
  userThesisWarning: z.string().nullable().default(null),
  citationIntegrity: citationIntegritySchema.nullable().default(null),
  // Per-run portfolio snapshot (Slice 5), computed server-side at `seedSession`
  // from the app-owned `accounts` + `holdings` + `quotes` tables (FIX-772/
  // FIX-823). The pipeline
  // runs blind to these — only the lens pack (phase-2b), the trader (P3), and
  // the PM (P5) read them via the `portfolioContext` capability preset. Null →
  // portfolio-blind run.
  portfolio: portfolioContextInput.nullable().default(null),
  // Which account(s) the user is considering this position for; subset of
  // `portfolio.accounts[].id`. Empty → let the PM suggest.
  selectedAccountIds: z.array(z.string()).default([]),
  // Per-run risk-appetite mandate (FIX-752), resolved at `seedSession` from the
  // per-run override or the most-conservative selected-account default and frozen
  // here as the full dial object. The reward-to-risk tap reads its `lossAversion`;
  // the PM reads it as `<riskMandate>` context and the commit gates SIZE against
  // it. Null → mandate-blind: no worth-it size gate, the run behaves exactly as
  // before FIX-752.
  riskMandate: riskMandateSchema.nullable().default(null),
  // Standing per-position thesis for the run's ticker (FIX-760), read from the
  // user-scoped `theses` resource collection at `seedSession` and frozen here. The pipeline
  // (P1–P2) runs blind to it — only the trader (P3) and PM (P5) read it via the
  // `standingThesis` capability preset, so the independent analyst evidence stays
  // uncontaminated (the `portfolioContext` injection points). Distinct from the
  // per-run `userThesis` (the Phase 6 hypothesis-under-audit) — this is durable
  // standing intent, never merged with it. Null → thesis-blind run.
  standingThesis: thesisRecordSchema.nullable().default(null),
  // Durable household portfolio mandate (IPS, FIX-761), read from the user-scoped
  // `portfolioMandate` resource at `seedSession`, re-validated, and frozen here as
  // the full object. The pipeline (P1–P4) runs blind to it — only the PM (P5)
  // reads it via the `portfolioMandate` capability preset, and the PM commit gates
  // SIZE against its standing constraints deterministically. Null → mandate-blind
  // run (a business-invalid persisted record degrades to null at seed, §4.5).
  portfolioMandate: portfolioMandateSchema.nullable().default(null),
  // The analyzed ticker's HOUSEHOLD weight (% of the full book), computed at seed
  // from the pre-scoping `allAccounts` read so a scoped run still measures a
  // household `maxPositionWeightPct` cap against the household, not one account.
  // Null when the name IS held but can't be priced (the policy gate then skips the
  // clamp rather than fabricating a full exit — never coerce to 0); 0 when the name
  // is not held (initiating). Frozen for the PM commit's policy gate (FIX-761).
  householdTickerWeightPct: z.number().nullable().default(null),
  // The analyzed ticker's weight in the RUN'S OWN NAV basis (the scoped snapshot,
  // which equals the household snapshot on an unscoped run). This is the
  // basis-consistent no-add reference for the FIX-781 evidence gate — distinct
  // from the household cap reference above. Same three-value contract: 0 not-held /
  // portfolio-blind, positive when every scoped row is priced, null when any is
  // unpriced (the gate then withholds the numeric target rather than trim off a
  // partial sum). Frozen for the PM commit's evidence gate.
  scopedTickerWeightPct: z.number().nullable().default(null),
});

export type SessionState = z.infer<typeof sessionStateSchema>;
