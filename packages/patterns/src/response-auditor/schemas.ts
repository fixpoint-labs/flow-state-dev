import { z } from "zod";

// ---------------------------------------------------------------------------
// Annotation & Analyzer Result
// ---------------------------------------------------------------------------

export const AuditAnnotationSchema = z.object({
  type: z.string(),
  label: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  description: z.string(),
  evidence: z.string().optional(),
});

export type AuditAnnotation = z.infer<typeof AuditAnnotationSchema>;

export const AnalyzerResultSchema = z.object({
  analyzerId: z.string(),
  category: z.string(),
  score: z.number().min(0).max(1),
  shouldSurface: z.boolean(),
  annotations: z.array(AuditAnnotationSchema),
  supplementary: z.record(z.unknown()).optional(),
});

export type AnalyzerResult = z.infer<typeof AnalyzerResultSchema>;

// ---------------------------------------------------------------------------
// Auditor Input (what captureContext produces)
// ---------------------------------------------------------------------------

export const auditorInputSchema = z.object({
  userInput: z.string(),
  response: z.string(),
});

export type AuditorInput = z.infer<typeof auditorInputSchema>;

// ---------------------------------------------------------------------------
// Sequencer State
// ---------------------------------------------------------------------------

export const responseAuditorStateSchema = z.object({
  userInput: z.string().default(""),
  response: z.string().default(""),
  results: z.array(AnalyzerResultSchema).default([]),
  surfacedResults: z.array(AnalyzerResultSchema).default([]),
  overallScore: z.number().default(0),
});

export type ResponseAuditorState = z.infer<typeof responseAuditorStateSchema>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type DisplayMode = "inline" | "message";

export interface ResponseAuditorConfig {
  /** Pluggable analyzer blocks. Each receives `{ userInput, response }` and returns `AnalyzerResult`. */
  analyzers: import("@flow-state-dev/core/types").BlockDefinition<any, any>[];
  /** Global threshold (default 0.3) — only surface results above this score. */
  threshold?: number;
  /** How to render annotations in UI. */
  displayMode?: DisplayMode;
  /** Run even if no analyzers exceed threshold (default true). */
  alwaysRun?: boolean;
  /** Parallel analyzer limit (default: all). */
  maxConcurrency?: number;
}
