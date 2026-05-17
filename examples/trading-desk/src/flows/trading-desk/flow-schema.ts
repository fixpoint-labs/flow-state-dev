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
});

export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;
