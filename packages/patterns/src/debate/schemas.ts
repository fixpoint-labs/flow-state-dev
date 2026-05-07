/**
 * Debate schemas — input, transcript-entry (with stance), judge verdict,
 * outer state, and the session-scoped writable resource that holds the
 * accumulating debate transcript.
 *
 * The transcript resource is the canonical store for what each debater
 * argued in each round; the per-(round, debater) audit trail lives in a
 * sequencer-backed `TaskCollection` for DevTool visibility.
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

/** Input shape accepted by a `debate` block. */
export const debateInputSchema = z.object({
  question: z.string(),
});
export type DebateInput = z.infer<typeof debateInputSchema>;

/** A single debate turn — one debater's argument in one round. */
export const debateContributionEntrySchema = z.object({
  round: z.number().int().min(1),
  agentName: z.string(),
  stance: z.string(),
  text: z.string(),
});
export type DebateContributionEntry = z.infer<
  typeof debateContributionEntrySchema
>;

/** Verdict the judge produces once after the loop ends. */
export const debateVerdictSchema = z.object({
  verdict: z.string(),
  /** Name of the stance the judge sided with, or null for synthesis. */
  winner: z.string().nullable(),
  reasoning: z.string(),
});
export type DebateVerdict = z.infer<typeof debateVerdictSchema>;

/** Outer sequencer state. */
export const debateStateSchema = z.object({
  question: z.string().default(""),
  round: z.number().default(0),
});
export type DebateState = z.infer<typeof debateStateSchema>;

/** Session-resource state: the append-only debate transcript. */
export const debateTranscriptStateSchema = z.object({
  entries: z.array(debateContributionEntrySchema).default([]),
});
export type DebateTranscriptState = z.infer<typeof debateTranscriptStateSchema>;

/**
 * Creates a session-scoped writable resource holding the debate
 * transcript. The pattern installs this internally; consumers may call
 * the factory directly when they need the canonical resource shape for
 * external read-access.
 */
export function createDebateTranscript() {
  return defineResource({
    scope: "session",
    stateSchema: debateTranscriptStateSchema,
    writable: true,
  });
}

/** Final shape produced by the loop and judge, before optional synthesizer. */
export interface DebateRawOutput {
  rounds: number;
  question: string;
  transcript: DebateContributionEntry[];
  verdict: DebateVerdict;
}
