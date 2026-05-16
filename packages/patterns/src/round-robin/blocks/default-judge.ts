/**
 * Default judge factory — generator that inspects the transcript and
 * returns `{ done, summary }`. Loop terminator for the round-robin
 * pattern.
 */
import { generator } from "@flow-state-dev/core";
import type {
  AgentType,
  GeneratorSlot,
  ToolsSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import type { DefinedResource } from "@flow-state-dev/core/types";
import {
  roundRobinJudgeOutputSchema,
  roundRobinStateSchema,
  type RoundRobinContributionsState,
  type RoundRobinState,
} from "../schemas";

export type JudgeInstructions =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

export interface CreateJudgeOptions {
  name: string;
  contributions: DefinedResource;
  model?: string;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
  tools?: ToolsSlot;
  instructions?: JudgeInstructions;
  agentType?: AgentType;
  /** Accessor key used in the block's `resources:` map. Defaults to
   *  `"contributions"`. See `createInitContributions` for rationale. */
  accessorKey?: string;
}

/** Build the default judge generator. */
export function createJudge(opts: CreateJudgeOptions) {
  const accessor = opts.accessorKey ?? "contributions";
  return generator({
    name: `${opts.name}-judge`,
    model: opts.model ?? "intent/synthesize",
    outputSchema: roundRobinJudgeOutputSchema,
    resources: { [accessor]: opts.contributions },
    sequencerStateSchema: roundRobinStateSchema,
    agentType: opts.agentType ?? "sub",
    ...(opts.context !== undefined ? { context: opts.context } : {}),
    ...(opts.uses ? { uses: opts.uses as any } : {}),
    ...(opts.tools !== undefined ? { tools: opts.tools as any } : {}),
    prompt: async (input, ctx) => {
      const resolved = opts.instructions
        ? typeof opts.instructions === "function"
          ? await opts.instructions(input, ctx)
          : opts.instructions
        : null;
      const instructionsBlock = resolved
        ? `\n## Overall Instructions\n${resolved}\n`
        : "";
      return [
        "You are evaluating a round-robin coordination process.",
        "Decide whether further rounds will improve the outcome.",
        "Return done=true when the contributions have converged or the",
        "goal is met. Provide a one-line summary of the current state.",
        instructionsBlock,
      ]
        .filter(Boolean)
        .join("\n");
    },
    user: (_input, ctx) => {
      const state = (ctx.sequencer?.state ?? {}) as RoundRobinState;
      const contribState = (ctx.resources as any)[accessor]
        ?.state as RoundRobinContributionsState | undefined;
      const entries = contribState?.entries ?? [];
      const transcript = entries
        .map((e) => `[Round ${e.round}] ${e.agentName}: ${e.text}`)
        .join("\n");
      return [
        `Goal: ${state.goal ?? ""}`,
        `Round ${state.round} just completed.`,
        `Transcript:\n${transcript || "(empty)"}`,
      ].join("\n");
    },
  });
}
