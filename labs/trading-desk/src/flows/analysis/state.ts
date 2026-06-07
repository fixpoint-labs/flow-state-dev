/**
 * Flow-level session state schema, lifted out of `flow.ts` so blocks can
 * reference it without creating an import cycle.
 *
 * `memoStatus` is a per-memo-key mirror of each resource's `status` field.
 * The navigator reads it via `useClientData` (the flow file passes it in
 * `client.expose`) so memos transition `pending → writing → published`
 * live mid-stream — body content still loads from `useResourceCollection`
 * at the terminal snapshot.
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
 * aborted before producing a recommendation. Two known causes:
 *   - `"unresolvable-ticker"` — the pre-flight guard could not resolve
 *      the ticker (missing fixture / all live providers unavailable).
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

export const sessionStateSchema = z.object({
  ticker: z.string().default("NVDA"),
  date: z.string().default("2026-05-06"),
  costPreset: z.enum(["fast", "full"]).default("fast"),
  dataSource: z.enum(["fixture", "live"]).default("fixture"),
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
  memoStatus: z
    .record(z.string(), z.enum(["pending", "writing", "published", "error"]))
    .default({}),
  runComplete: z.boolean().default(false),
  stoppedReason: z
    .enum(["unresolvable-ticker", "phase-1-missing-primary", "phase-1-no-data"])
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
  // from the user-scoped `accounts` + `portfolioQuotes` resources. The pipeline
  // runs blind to these — only the lens pack (phase-2b), the trader (P3), and
  // the PM (P5) read them via the `portfolioContext` capability preset. Null →
  // portfolio-blind run.
  portfolio: portfolioContextInput.nullable().default(null),
  // Which account(s) the user is considering this position for; subset of
  // `portfolio.accounts[].id`. Empty → let the PM suggest.
  selectedAccountIds: z.array(z.string()).default([]),
});

export type SessionState = z.infer<typeof sessionStateSchema>;
