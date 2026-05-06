/**
 * Default roster agent factory — a generator that reads the
 * contributions resource for prior turns and produces a `{ text }`
 * contribution.
 *
 * Override blocks supplied via `RosterEntry.block` bypass this; they
 * own their own prompt and resource declarations.
 */
import { generator } from "@flow-state-dev/core";
import type {
  AgentType,
  GeneratorSlot,
  ToolsSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import type { DefinedResource } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  roundRobinStateSchema,
  type RoundRobinContributionsState,
  type RoundRobinState,
} from "../schemas";

export type RosterAgentInstructions =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

const rosterAgentOutputSchema = z.object({ text: z.string() });

function formatPrior(entries: { round: number; agentName: string; text: string }[]) {
  if (entries.length === 0) return "";
  const byRound = new Map<number, typeof entries>();
  for (const e of entries) {
    const arr = byRound.get(e.round) ?? [];
    arr.push(e);
    byRound.set(e.round, arr);
  }
  const lines: string[] = [];
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    lines.push(`Round ${round}:`);
    for (const entry of byRound.get(round)!) {
      lines.push(`- ${entry.agentName}: ${entry.text}`);
    }
  }
  return lines.join("\n");
}

export interface CreateRosterAgentOptions {
  name: string;
  agentName: string;
  role?: string;
  contributions: DefinedResource;
  model?: string;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
  tools?: ToolsSlot;
  instructions?: RosterAgentInstructions;
  agentType?: AgentType;
}

/**
 * Build a default roster-agent generator. Renders prior contributions
 * from the resource into the prompt; emits `{ text }`.
 */
export function createRosterAgent(opts: CreateRosterAgentOptions) {
  const roleLine = opts.role
    ? `You are ${opts.role} contributing to a round-robin coordination process.`
    : "You are an agent contributing to a round-robin coordination process.";
  return generator({
    name: `${opts.name}-roster-${opts.agentName}`,
    model: opts.model ?? "preset/fast",
    outputSchema: rosterAgentOutputSchema,
    resources: { contributions: opts.contributions },
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
        roleLine,
        `Your name is "${opts.agentName}".`,
        "Provide your contribution. Be specific; build on or push back",
        "against prior contributions where appropriate.",
        instructionsBlock,
      ]
        .filter(Boolean)
        .join("\n");
    },
    user: (_input, ctx) => {
      const state = (ctx.sequencer?.state ?? {}) as RoundRobinState;
      const contribState = ctx.resources.contributions
        ?.state as RoundRobinContributionsState | undefined;
      const entries = contribState?.entries ?? [];
      const priorBlock =
        entries.length > 0
          ? `\nPrior contributions:\n${formatPrior(entries)}\n`
          : "";
      return [
        `Goal: ${state.goal ?? ""}`,
        `Round: ${state.round}`,
        priorBlock,
      ]
        .filter(Boolean)
        .join("\n");
    },
  });
}
