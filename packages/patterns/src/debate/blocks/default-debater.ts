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
  AgentType,
  GeneratorSlot,
  ToolsSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import type { DefinedResource } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  debateStateSchema,
  type DebateState,
  type DebateTranscriptState,
} from "../schemas";

export type DebaterInstructions =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

const debaterOutputSchema = z.object({ text: z.string() });

/** Render prior arguments as a stance-tagged transcript, in turn order. */
function formatPriorForDebater(
  entries: { round: number; stance: string; text: string }[],
): string {
  if (entries.length === 0) return "";
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`[${e.stance}] ${e.text}`);
  }
  return lines.join("\n");
}

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
  agentType?: AgentType;
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
  return generator({
    name: `${opts.name}-debater-${opts.agentName}`,
    model: opts.model ?? "intent/chat",
    outputSchema: debaterOutputSchema,
    resources: { transcript: opts.transcript },
    sequencerStateSchema: debateStateSchema,
    agentType: opts.agentType ?? "sub",
    // Surface a live "Advocate is responding..." string in the global
    // status slot while this block runs. Without it the UI sits silent
    // through tool loops and the model's main generation; the renderer
    // also emits an inline pending row but the global status is the
    // fallback for non-debate UIs.
    activeStatusMessage: `${opts.agentName} is composing a response...`,
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
      const state = (ctx.sequencer?.state ?? {}) as DebateState;
      const transcriptState = ctx.resources.transcript
        ?.state as DebateTranscriptState | undefined;
      const entries = transcriptState?.entries ?? [];
      const priorBlock =
        entries.length > 0
          ? `\nPrior arguments (in order):\n${formatPriorForDebater(entries)}\n`
          : "";
      // Pick the moderator decision that opened THIS round (the one whose
      // round number matches state.round). With the moderator running at
      // the top of the round, the most recent decision is the current
      // round's opener — but match on `round` explicitly to stay robust
      // if the loop order ever changes.
      const decisions = state.moderatorDecisions ?? [];
      const currentDecision =
        decisions.find((d) => d.round === state.round) ?? null;
      const briefingBlock =
        currentDecision && currentDecision.briefing
          ? `\nBriefing from the moderator:\n${currentDecision.briefing}\n`
          : "";
      const angleBlock =
        currentDecision && currentDecision.newAngle
          ? `\nFocus for this round:\n${currentDecision.newAngle}\n`
          : "";
      return [
        `Question under debate: ${state.question ?? ""}`,
        `Round ${state.round} of ${opts.maxRounds}.`,
        priorBlock,
        briefingBlock,
        angleBlock,
      ]
        .filter(Boolean)
        .join("\n");
    },
  });
}
