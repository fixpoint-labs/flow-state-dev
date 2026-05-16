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
 */
import { z } from "zod";

export const sessionStateSchema = z.object({
  ticker: z.string().default("NVDA"),
  date: z.string().default("2026-05-06"),
  costPreset: z.enum(["fast", "full"]).default("fast"),
  dataSource: z.enum(["fixture", "live"]).default("fixture"),
  activePhase: z
    .enum(["idle", "phase-1", "phase-2", "phase-3", "phase-4", "phase-5"])
    .default("idle"),
  maxDebateRounds: z.number().int().min(1).max(2).default(1),
  memoStatus: z
    .record(z.string(), z.enum(["pending", "writing", "published", "error"]))
    .default({}),
  runComplete: z.boolean().default(false),
});

export type SessionState = z.infer<typeof sessionStateSchema>;
