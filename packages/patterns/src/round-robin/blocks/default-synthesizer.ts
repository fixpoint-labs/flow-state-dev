/**
 * Default synthesizer factory — runs after the loop terminates and
 * shapes the final pattern output. Mirrors plan-and-execute's
 * synthesizer pattern.
 */
import { generator } from "@flow-state-dev/core";
import type {
  AgentType,
  GeneratorSlot,
  ToolsSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import { z, type ZodTypeAny } from "zod";
import type { RoundRobinFinalShape } from "../schemas";

export type SynthesizerInstructions =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

export interface CreateSynthesizeOptions {
  name: string;
  outputSchema?: ZodTypeAny;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
  tools?: ToolsSlot;
  instructions?: SynthesizerInstructions;
  model?: string;
  agentType?: AgentType;
}

/** Build the default round-robin synthesizer. */
export function createSynthesize(opts: CreateSynthesizeOptions) {
  const basePrompt = [
    "You are the final synthesis step in a round-robin coordination",
    "process. Combine the agents' contributions into the FINAL",
    "DELIVERABLE the user requested. Merge overlapping content and",
    "resolve conflicts so the result reads as one unified piece.",
  ].join("\n");
  return generator({
    name: `${opts.name}-synthesizer`,
    model: opts.model ?? "intent/synthesize",
    outputSchema: opts.outputSchema ?? z.string(),
    ...(opts.context !== undefined ? { context: opts.context } : {}),
    ...(opts.uses ? { uses: opts.uses as any } : {}),
    ...(opts.tools !== undefined ? { tools: opts.tools as any } : {}),
    agentType: opts.agentType ?? "primary",
    prompt: [opts.instructions, basePrompt],
    user: (input: unknown) => {
      const data = input as RoundRobinFinalShape;
      const transcript = data.contributions
        .map((e) => `[Round ${e.round}] ${e.agentName}: ${e.text}`)
        .join("\n");
      return [
        `Rounds executed: ${data.rounds}`,
        `Judge verdict: ${data.done ? "done" : "max-rounds"}`,
        data.summary ? `Judge summary: ${data.summary}` : "",
        `Transcript:\n${transcript}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    },
  });
}
