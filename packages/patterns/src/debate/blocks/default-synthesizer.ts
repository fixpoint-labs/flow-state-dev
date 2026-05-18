/**
 * Default debate synthesizer factory — runs after the judge's verdict
 * and projects `DebateRawOutput` into a final shape. Mirrors the
 * round-robin synthesizer.
 */
import { generator } from "@flow-state-dev/core";
import type {
  AgentType,
  GeneratorSlot,
  ToolsSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import { z, type ZodTypeAny } from "zod";
import type { DebateRawOutput } from "../schemas";

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

/** Build the default debate synthesizer. */
export function createSynthesize(opts: CreateSynthesizeOptions) {
  const basePrompt = [
    "You are the final synthesis step after a structured debate.",
    "Use the judge's verdict and the transcript to produce the final",
    "deliverable in the shape requested by the caller.",
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
      const data = input as DebateRawOutput;
      const transcript = data.transcript
        .map(
          (e) => `[Round ${e.round}] [${e.stance}] ${e.text}`,
        )
        .join("\n");
      const framingEntries = (data.moderatorDecisions ?? [])
        .map((d) => {
          const parts: string[] = [];
          if (d.briefing && d.briefing !== "") parts.push(`briefing: ${d.briefing}`);
          if (d.newAngle && d.newAngle !== "") parts.push(`angle: ${d.newAngle}`);
          return parts.length > 0
            ? `- [round ${d.round}] ${parts.join(" | ")}`
            : null;
        })
        .filter((s): s is string => s !== null);
      const moderatorBlock =
        framingEntries.length > 0
          ? `Moderator framing across rounds:\n${framingEntries.join("\n")}`
          : "";
      return [
        `Question: ${data.question}`,
        `Rounds executed: ${data.rounds}`,
        `Judge verdict: ${data.verdict.verdict}`,
        `Judge winner: ${data.verdict.winner ?? "(synthesis)"}`,
        `Judge reasoning: ${data.verdict.reasoning}`,
        moderatorBlock,
        `Transcript:\n${transcript}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    },
  });
}
