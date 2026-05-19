/**
 * Default moderator factory — a generator that opens each round of the
 * debate. It picks who speaks in the round, can supply a research
 * briefing for the debaters, can name a focus angle, and can declare
 * that this should be the final round.
 *
 * The moderator sees the full, ordered, name-tagged transcript so far
 * (which is empty in round 1) plus the history of its own decisions.
 * It is NOT subject to the judge's `anonymizeTranscript` toggle —
 * knowing who said what is necessary for dispatch decisions.
 *
 * Pass `tools` or `uses` to give the moderator research capabilities
 * (e.g. web search, fetch). When tools are configured, the default
 * prompt nudges the moderator to gather current information and
 * summarize it in `briefing` so every debater in the round argues from
 * the same factual base.
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
  debateModeratorOutputSchema,
  debateStateSchema,
  type DebateState,
  type DebateTranscriptState,
} from "../schemas";

export type ModeratorInstructions =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

export interface CreateModeratorOptions {
  name: string;
  /**
   * Names of all debaters in the roster. Listed in the moderator prompt
   * so the moderator's `nextSpeakers` choices are constrained to known
   * names. Out-of-roster picks are rejected by the dispatch factory at
   * runtime.
   */
  rosterNames: string[];
  transcript: DefinedResource;
  model?: string;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
  tools?: ToolsSlot;
  instructions?: ModeratorInstructions;
  agentType?: AgentType;
}

/**
 * Build the default moderator generator. Returns
 * `{ nextSpeakers, newAngle, done }` per round.
 */
export function createModerator(opts: CreateModeratorOptions) {
  return generator({
    name: `${opts.name}-moderator`,
    model: opts.model ?? "intent/synthesize",
    outputSchema: debateModeratorOutputSchema,
    resources: { transcript: opts.transcript },
    sequencerStateSchema: debateStateSchema,
    agentType: opts.agentType ?? "sub",
    // The moderator's tool loop can run for a while before it commits a
    // decision. Surface a global status so it's clear work is in flight.
    activeStatusMessage: (_input, ctx) => {
      const state = (ctx.sequencer?.state ?? {}) as DebateState;
      return state.round > 0
        ? `Moderator opening round ${state.round}...`
        : "Moderator preparing...";
    },
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
      const rosterBlock = opts.rosterNames.length > 0
        ? opts.rosterNames.map((n) => `- ${n}`).join("\n")
        : "(none)";
      return [
        "You are moderating a structured debate. You open each round by",
        "deciding who speaks and how the round is framed. The debaters you",
        "name will see your briefing and angle before they argue.",
        "",
        "Available debaters (you MUST only return names from this list):",
        rosterBlock,
        "",
        "If research tools are available to you (e.g. web search, fetch),",
        "use them to gather current information before opening the round.",
        "Summarize the key facts you found in `briefing` so every debater",
        "argues from the same factual base — that's the value of having a",
        "moderator vs. letting each debater research separately.",
        "",
        "Your decision must include:",
        "- nextSpeakers: who speaks this round, in the order they should",
        "  speak. **Default to the full roster every round** so both sides",
        "  get equal opportunity to argue, rebut, and close. Only deviate",
        "  from this default for a specific, defensible reason — e.g. one",
        "  side has already conceded a point in writing, or a single",
        "  speaker needs a focused turn to answer a direct challenge from",
        "  the prior round. A debate where one side never spoke in a round",
        "  feels broken to readers; bias toward inclusion. Earlier",
        "  speakers' arguments are visible to later speakers within the",
        "  same round. If `done` is true you may still name speakers and",
        "  they get a closing round; return [] only to end without further",
        "  debate.",
        "- briefing: contextual information for the debaters this round.",
        "  Use this for the round's setup: the question being argued,",
        "  relevant facts you gathered via tools, framing that orients",
        "  both sides. Return null if no briefing is needed (e.g. the",
        "  prior round's transcript already establishes context).",
        "- newAngle: an optional focus question or reframing for this round.",
        "  Use when you want the debaters to focus on a specific aspect or",
        "  to probe a specific point further. Return null if no shift is",
        "  needed.",
        "- done: true if this should be the final round. The framework",
        "  also enforces a maxRounds cap; you do not need to track it.",
        "",
        "Round 1 has no transcript yet — open with the full roster, a",
        "briefing that frames the question, and any research findings.",
        "Later rounds: keep the full roster by default. The `newAngle`",
        "field is your primary tool for shaping later rounds — use it to",
        "probe further or shift focus rather than dropping a debater.",
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
      const byRound = new Map<number, typeof entries>();
      for (const e of entries) {
        const arr = byRound.get(e.round) ?? [];
        arr.push(e);
        byRound.set(e.round, arr);
      }
      const transcriptLines: string[] = [];
      for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
        for (const entry of byRound.get(round)!) {
          transcriptLines.push(
            `[Round ${entry.round}] [${entry.stance}] ${entry.agentName}: ${entry.text}`,
          );
        }
      }
      const transcriptBlock =
        transcriptLines.length > 0 ? transcriptLines.join("\n") : "(none yet — this is the opening round)";

      const priorDecisions = state.moderatorDecisions ?? [];
      const decisionsBlock =
        priorDecisions.length > 0
          ? priorDecisions
              .map(
                (d) =>
                  `[Round ${d.round}] nextSpeakers=${JSON.stringify(d.nextSpeakers)} ` +
                  `briefing=${d.briefing === null ? "null" : JSON.stringify(d.briefing)} ` +
                  `newAngle=${d.newAngle === null ? "null" : JSON.stringify(d.newAngle)} ` +
                  `done=${d.done}`,
              )
              .join("\n")
          : "(none — this is your first decision)";

      return [
        `Question: ${state.question ?? ""}`,
        `You are opening round ${state.round}.`,
        `Transcript so far:\n${transcriptBlock}`,
        `Your prior decisions:\n${decisionsBlock}`,
      ].join("\n\n");
    },
  });
}
