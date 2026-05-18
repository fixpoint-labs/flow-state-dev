/**
 * Default moderator factory — a generator that reads the debate
 * transcript at the end of each round and decides who speaks next,
 * whether to inject a redirection (`newAngle`), and whether the debate
 * is finished. Optional; when no moderator is configured the debate
 * runs in fixed declared-roster order.
 *
 * The moderator sees the full, ordered, name-tagged transcript and the
 * history of its own decisions. It does NOT receive the judge's
 * anonymization toggle — knowing who said what is necessary for
 * dispatch.
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
        "You are moderating a structured debate. Read the transcript and decide",
        "what should happen in the next round.",
        "",
        "Available debaters (you MUST only return names from this list):",
        rosterBlock,
        "",
        "Your decision must include:",
        "- nextSpeakers: which debaters speak next round, in the order they",
        "  should speak. May be all of them, a subset, or just one. Earlier",
        "  speakers' arguments are visible to later speakers within the same",
        "  round. If done is true, return [].",
        "- newAngle: an optional reframing or sub-question to inject into the",
        "  next round. Use this when the panel has plateaued, when an",
        "  unexamined angle deserves engagement, or when arguments are",
        "  rehashing prior rounds. Return null if no redirection is needed.",
        "- done: true if the debate is sufficiently explored. The framework",
        "  also enforces a maxRounds cap; you do not need to track it.",
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
        transcriptLines.length > 0 ? transcriptLines.join("\n") : "(empty)";

      const priorDecisions = state.moderatorDecisions ?? [];
      const decisionsBlock =
        priorDecisions.length > 0
          ? priorDecisions
              .map(
                (d) =>
                  `[Round ${d.round}] nextSpeakers=${JSON.stringify(d.nextSpeakers)} ` +
                  `newAngle=${d.newAngle === null ? "null" : JSON.stringify(d.newAngle)} ` +
                  `done=${d.done}`,
              )
              .join("\n")
          : "(none)";

      return [
        `Question: ${state.question ?? ""}`,
        `Round ${state.round} just completed.`,
        `Transcript so far:\n${transcriptBlock}`,
        `Your prior decisions:\n${decisionsBlock}`,
      ].join("\n\n");
    },
  });
}
