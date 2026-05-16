/**
 * Default referee factory — generator that audits each round's
 * contributions for argument quality and returns `{ critique }`. Optional;
 * does not control loop termination.
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
  roundRobinRefereeOutputSchema,
  roundRobinStateSchema,
  type RoundRobinContributionsState,
  type RoundRobinState,
} from "../schemas";

export type RefereeInstructions =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

export interface CreateRefereeOptions {
  name: string;
  contributions: DefinedResource;
  model?: string;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
  tools?: ToolsSlot;
  instructions?: RefereeInstructions;
  agentType?: AgentType;
  /** Accessor key used in the block's `resources:` map. Defaults to
   *  `"contributions"`. See `createInitContributions` for rationale. */
  accessorKey?: string;
}

/** Build the default referee generator. */
export function createReferee(opts: CreateRefereeOptions) {
  const accessor = opts.accessorKey ?? "contributions";
  return generator({
    name: `${opts.name}-referee`,
    model: opts.model ?? "intent/synthesize",
    outputSchema: roundRobinRefereeOutputSchema,
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
        "You are auditing a multi-agent debate for argument quality. Read",
        "the round's contributions and flag specific cases where a",
        "contributor appears to be:",
        "- exaggerating evidence to defend a predetermined stance",
        "- dismissing strong opposing points without rebuttal",
        "- introducing claims not supported by the data provided",
        "- retreating to vague language to avoid concrete engagement",
        "Return a short, specific critique pointing at named contributors",
        "and quoted passages where possible. Do not declare a winner. Do",
        "not decide whether more rounds are needed.",
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
