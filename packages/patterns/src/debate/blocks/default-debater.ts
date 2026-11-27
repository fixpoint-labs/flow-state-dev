/**
 * Default debater factory — a generator that reads the transcript
 * resource for prior arguments (this and prior rounds) and produces a
 * `{ text }` argument defending its assigned stance.
 *
 * Debater prompts render the prior transcript stance-tagged but NOT
 * name-tagged, so identity-self-bias is contained at the debater layer
 * regardless of the judge-side anonymization toggle.
 */
import { generator } from "@flow-state-dev/core";
import type {
  ItemVisibility,
  GeneratorSlot,
  ToolsSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import type { DefinedResource } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  debateStateSchema,
  type DebateContextSlot,
} from "../schemas";

export type DebaterInstructions =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

export interface CreateDebaterOptions {
  name: string;
  agentName: string;
  stance: string;
  role?: string;
  maxRounds: number;
  transcript: DefinedResource;
  model?: string;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
  tools?: ToolsSlot;
  instructions?: DebaterInstructions;
  itemVisibility?: ItemVisibility;
}

/**
 * Build a default debater generator. Reads prior arguments from the
 * transcript resource and emits `{ text }`. The default prompt is
 * non-conceding (per the sycophancy literature).
 */
export function createDebater(opts: CreateDebaterOptions) {
  const roleLine = opts.role
    ? `Your perspective: ${opts.role}`
    : null;
  const context: DebateContextSlot | undefined = opts.context;
  return generator({
    name: `${opts.name}-debater-${opts.agentName}`,
    model: opts.model ?? "intent/chat",
    // Plain-string output is intentional: with a structured schema the
    // model is forced into JSON mode, which prevents the framework from
    // streaming content as it generates. The recorder coerces both
    // `string` and `{ text: string }` shapes, so custom override blocks
    // can still return either.
    outputSchema: z.string(),
    // Stamp the streamed `message` items with the role name (e.g.
    // "advocate") instead of the long generator name, so renderers can
    // attribute streaming text to a debater by short identity.
    agentName: opts.agentName,
    resources: { transcript: opts.transcript },
    sequencerStateSchema: debateStateSchema,
    itemVisibility: opts.itemVisibility ?? { client: true, history: false },
    // No `activeStatusMessage` here: the pattern emits an inline
    // `debate-turn-pending` row with the same information, and pairing
    // them produces two near-identical "{agentName} is composing..."
    // strings in the UI. The inline row wins because it's contextual
    // (visible inside the debate card with stance + streaming text).
    ...(context !== undefined ? { context } : {}),
    ...(opts.uses ? { uses: opts.uses } : {}),
    ...(opts.tools !== undefined ? { tools: opts.tools } : {}),
    prompt: async (input, ctx) => {
      const resolved = typeof opts.instructions === "function"
        ? await opts.instructions(input, ctx)
        : opts.instructions;
      const instructionsBlock = resolved
        ? `\n## Overall Instructions\n${resolved}\n`
        : "";
      return [
        "You are participating in a structured debate.",
        `Your assigned position: ${opts.stance}`,
        roleLine,
        `You are arguing for "${opts.stance}". Hold your position.`,
        "Address the strongest counter-arguments raised so far.",
        "Do not concede; if a prior argument is wrong, explain why.",
        "Be specific.",
        instructionsBlock,
      ]
        .filter(Boolean)
        .join("\n");
    },
    user: (_input, ctx) => {
      const state = ctx.sequencer?.state;
      const entries = ctx.resources.transcript?.state?.entries ?? [];
      let priorBlock = "";
      if (entries.length > 0) {
        const lines: string[] = [];
        for (const entry of entries) lines.push(`[${entry.stance}] ${entry.text}`);
        priorBlock = `\nPrior arguments (in order):\n${lines.join("\n")}\n`;
      }
      // Pick the moderator decision that opened THIS round (the one whose
      // round number matches state.round). With the moderator running at
      // the top of the round, the most recent decision is the current
      // round's opener — but match on `round` explicitly to stay robust
      // if the loop order ever changes.
      const currentDecision = state?.moderatorDecisions?.find((d) => d.round === state.round);
      const briefingBlock =
        currentDecision?.briefing
          ? `\nBriefing from the moderator:\n${currentDecision.briefing}\n`
          : "";
      const angleBlock =
        currentDecision?.newAngle
          ? `\nFocus for this round:\n${currentDecision.newAngle}\n`
          : "";
      return [
        `Question under debate: ${state?.question ?? ""}`,
        `Round ${state?.round} of ${opts.maxRounds}.`,
        priorBlock,
        briefingBlock,
        angleBlock,
      ]
        .filter(Boolean)
        .join("\n");
    },
  });
}
