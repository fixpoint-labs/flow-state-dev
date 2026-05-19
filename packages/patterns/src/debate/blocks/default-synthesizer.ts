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
  // The deliberation sentence varies based on whether a moderator was
  // configured. Without one, every debater speaks every round in
  // declared order and no framing is injected — claiming "a moderator
  // framed the discussion" in that case contradicts the user prompt
  // (which correctly emits no framing notes) and can drive the model
  // to confabulate framing it didn't have.
  const buildBasePrompt = (input: unknown): string => {
    const hasModerator =
      ((input as DebateRawOutput).moderatorDecisions ?? []).length > 0;
    const deliberationLine = hasModerator
      ? "Before you reply, you ran an internal deliberation: two or more debaters argued opposing positions across several rounds with a moderator framing the discussion, and a judge weighed the arguments to reach a conclusion."
      : "Before you reply, you ran an internal deliberation: two or more debaters argued opposing positions across several rounds, and a judge weighed the arguments to reach a conclusion.";
    return [
      "You are responding directly to the user. Their question is below.",
      "",
      deliberationLine,
      "That deliberation is your **private reasoning** — treat it the",
      "way a person treats their own thinking before answering a",
      "question.",
      "",
      "Your reply must:",
      "- Answer the user's question directly, in your own voice.",
      "- Lead with the conclusion. If the judge picked a winner, that's",
      "  your answer. If the judge synthesized, present the synthesized",
      "  view as your view.",
      "- Support the answer with the strongest reasoning surfaced in the",
      "  debate, presented as your reasoning (not as something a",
      "  debater said).",
      "",
      "Do NOT:",
      "- Mention the debate, the debaters, the moderator, the judge,",
      "  the rounds, the verdict, or the transcript.",
      "- Narrate the process (\"after careful consideration\", \"weighing",
      "  both sides\", etc.) — just answer.",
      "- Hedge with structure-flavored language (\"the proposition holds\",",
      "  \"the affirmative case is...\"). Talk like a person answering a",
      "  question, not like a debate moderator.",
    ].join("\n");
  };
  return generator({
    name: `${opts.name}-synthesizer`,
    model: opts.model ?? "intent/synthesize",
    outputSchema: opts.outputSchema ?? z.string(),
    ...(opts.context !== undefined ? { context: opts.context } : {}),
    ...(opts.uses ? { uses: opts.uses as any } : {}),
    ...(opts.tools !== undefined ? { tools: opts.tools as any } : {}),
    agentType: opts.agentType ?? "primary",
    prompt: [opts.instructions, buildBasePrompt],
    user: (input: unknown) => {
      const data = input as DebateRawOutput;
      const transcript = data.transcript
        .map((e) => `[Round ${e.round}] [${e.stance}] ${e.text}`)
        .join("\n");
      const framingEntries = (data.moderatorDecisions ?? [])
        .map((d) => {
          const parts: string[] = [];
          if (d.briefing && d.briefing !== "")
            parts.push(`briefing: ${d.briefing}`);
          if (d.newAngle && d.newAngle !== "")
            parts.push(`angle: ${d.newAngle}`);
          return parts.length > 0
            ? `- [round ${d.round}] ${parts.join(" | ")}`
            : null;
        })
        .filter((s): s is string => s !== null);
      const framingBlock =
        framingEntries.length > 0
          ? `Framing notes you made along the way:\n${framingEntries.join("\n")}`
          : "";
      return [
        `The user asked: ${data.question}`,
        "",
        "## Your private reasoning (do not reference this in your reply)",
        "",
        `Conclusion you reached: ${data.verdict.verdict}`,
        data.verdict.winner
          ? `Position that won out: ${data.verdict.winner}`
          : "You synthesized rather than picking one side.",
        `Why: ${data.verdict.reasoning}`,
        framingBlock,
        `Arguments you considered:\n${transcript}`,
        "",
        "Now answer the user directly.",
      ]
        .filter(Boolean)
        .join("\n\n");
    },
  });
}
