/**
 * `analyzeInputSchema` lifted out of `flow.ts` so guard handlers can import
 * it without creating a cycle through the flow definition.
 */
import { z } from "zod";

export const analyzeInputSchema = z.object({
  ticker: z.string().min(1).default("NVDA"),
  date: z.string().min(1).default("2026-05-06"),
  costPreset: z.enum(["fast", "full"]).default("fast"),
  dataSource: z.enum(["fixture", "live"]).default("fixture"),
  // Optional per-run user thesis. The pipeline (P1–P5) never sees these —
  // they feed the Phase 6 post-decision audit only. A non-null `userThesis`
  // gates Phase 6; null skips it entirely.
  userThesis: z.string().max(1500).nullable().default(null),
  userThesisRationale: z.string().max(1500).nullable().default(null),
});

export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;
