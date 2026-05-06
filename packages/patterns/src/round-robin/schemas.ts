/**
 * Round Robin schemas — input, contribution entry, judge output, and the
 * session-scoped writable resource that holds the running transcript.
 *
 * The contributions resource is the canonical store for what each roster
 * agent has said in each round; the per-(round, agent) audit lives in a
 * sequencer-backed `TaskCollection` for DevTool visibility.
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

/** Input shape accepted by a `roundRobin` block. */
export const roundRobinInputSchema = z.object({
  goal: z.string(),
});
export type RoundRobinInput = z.infer<typeof roundRobinInputSchema>;

/** A single roster turn — one agent's contribution in one round. */
export const roundRobinContributionEntrySchema = z.object({
  round: z.number().int().min(1),
  agentName: z.string(),
  text: z.string(),
});
export type RoundRobinContributionEntry = z.infer<
  typeof roundRobinContributionEntrySchema
>;

/** Verdict the judge must return at the end of each round. */
export const roundRobinJudgeOutputSchema = z.object({
  done: z.boolean(),
  summary: z.string().default(""),
});
export type RoundRobinJudgeOutput = z.infer<
  typeof roundRobinJudgeOutputSchema
>;

/** Outer sequencer state. */
export const roundRobinStateSchema = z.object({
  goal: z.string().default(""),
  round: z.number().default(0),
  done: z.boolean().default(false),
  lastJudgeSummary: z.string().optional(),
});
export type RoundRobinState = z.infer<typeof roundRobinStateSchema>;

/** Session-resource state: the append-only transcript of entries. */
export const roundRobinContributionsStateSchema = z.object({
  entries: z.array(roundRobinContributionEntrySchema).default([]),
});
export type RoundRobinContributionsState = z.infer<
  typeof roundRobinContributionsStateSchema
>;

/**
 * Creates a session-scoped writable resource holding the round-robin
 * transcript. The pattern installs this internally; consumers only call
 * the factory directly when they need the canonical resource shape for
 * external read-access (kept available for future expansion).
 */
export function createRoundRobinContributions() {
  return defineResource({
    scope: "session",
    stateSchema: roundRobinContributionsStateSchema,
    writable: true,
  });
}

/** Final shape produced by the loop, before optional synthesizer. */
export interface RoundRobinFinalShape {
  rounds: number;
  done: boolean;
  summary: string;
  contributions: RoundRobinContributionEntry[];
}
