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
import {
  roundRobinStateSchema,
  type RoundRobinContributionsState,
} from "../schemas";

export type RosterAgentInstructions =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

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

function formatRefereeCritiques(
  critiques: { round: number; critique: string }[],
) {
  if (critiques.length === 0) return "";
  return critiques
    .slice()
    .sort((a, b) => a.round - b.round)
    .map((c) => `[Round ${c.round}] ${c.critique}`)
    .join("\n");
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
  /** Accessor key used in the block's `resources:` map. Defaults to
   *  `"contributions"`. See `createInitContributions` for rationale. */
  accessorKey?: string;
}

/**
 * Build a default roster-agent generator. Renders prior contributions
 * from the resource into the prompt; emits `{ text }`.
 */
export function createRosterAgent(opts: CreateRosterAgentOptions) {
  const accessor = opts.accessorKey ?? "contributions";
  const roleLine = opts.role
    ? `You are ${opts.role} contributing to a round-robin coordination process.`
    : "You are an agent contributing to a round-robin coordination process.";
  // Output is plain text (no `outputSchema` override) so the generator's
  // streaming gate enables — the agent emits live `message` items as it
  // types, which makes the round-robin visible to chat-style transcripts
  // without forcing every consumer to write a custom roster block. The
  // recorder (`record-contribution.ts`) coerces strings via `coerceText`,
  // so the contributions resource is unchanged. Authors who genuinely need
  // structured roster output (e.g. a vote roster emitting `{ choice }`)
  // should pass `block:` on their RosterEntry to override the default.
  //
  // `agentName` is forwarded so emitted items carry identity. Without it,
  // chat transcripts that filter by known agent (e.g. trading-desk's
  // theses pane) silently drop the messages even though the streaming
  // path works correctly.
  return generator({
    name: `${opts.name}-roster-${opts.agentName}`,
    model: opts.model ?? "intent/chat",
    resources: { [accessor]: opts.contributions },
    sequencerStateSchema: roundRobinStateSchema,
    agentType: opts.agentType ?? "sub",
    agentName: opts.agentName,
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
    user: async (_input, ctx) => {
      const state = ctx.sequencer!.state;
      // TODO: computed-key resource accessor — see round-robin follow-up
      const contribState = (await (ctx.resources as any)[accessor]
        ?.state()) as RoundRobinContributionsState | undefined;
      const entries = contribState?.entries ?? [];
      const priorBlock =
        entries.length > 0
          ? `\nPrior contributions:\n${formatPrior(entries)}\n`
          : "";
      const critiques = state.refereeCritiques ?? [];
      const refereeBlock =
        critiques.length > 0
          ? `\nReferee critiques so far:\n${formatRefereeCritiques(critiques)}\n`
          : "";
      return [
        `Goal: ${state.goal ?? ""}`,
        `Round: ${state.round}`,
        priorBlock,
        refereeBlock,
      ]
        .filter(Boolean)
        .join("\n");
    },
  });
}
