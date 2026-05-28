/**
 * Default judge factory — a generator that reads the full debate
 * transcript at the end of the loop and returns a structured
 * `{ verdict, winner, reasoning }`.
 *
 * Two bias mitigations are applied at prompt-render time:
 *   - `anonymizeTranscript` (default true) strips debater names; only
 *     stances are rendered, mitigating identity-driven self-bias when
 *     the judge model matches a debater model.
 *   - `shuffleForJudge` (default true) randomizes per-round argument
 *     order in the rendered transcript, mitigating LLM-judge position
 *     bias toward the first or last argument.
 *
 * Tests can inject a deterministic RNG via `random` to make shuffled
 * prompts reproducible.
 */
import { generator } from "@flow-state-dev/core";
import type {
  AgentType,
  GeneratorSlot,
  InstructionsSlot,
  ToolsSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import type { DefinedResource } from "@flow-state-dev/core/types";
import {
  debateStateSchema,
  debateVerdictSchema,
  type DebateContributionEntry,
  type DebateTranscriptState,
} from "../schemas";

export interface CreateJudgeOptions {
  name: string;
  transcript: DefinedResource;
  /** Stances to list as the candidate positions in the prompt header. */
  stances: string[];
  /** Default true. */
  anonymizeTranscript?: boolean;
  /** Default true. */
  shuffleForJudge?: boolean;
  /** Optional injected RNG for deterministic shuffling in tests. */
  random?: () => number;
  model?: string;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
  tools?: ToolsSlot;
  instructions?: InstructionsSlot;
  agentType?: AgentType;
}

/**
 * Format the transcript for the judge. Groups entries by round, applies
 * optional per-round shuffling and optional name anonymization.
 *
 * Exported for tests; consumers building a custom judge can also reuse
 * it to render a transcript identical to the default judge's view.
 */
export function formatTranscriptForJudge(
  entries: DebateContributionEntry[],
  opts: { anonymize: boolean; shuffle: boolean; random?: () => number },
): string {
  if (entries.length === 0) return "(empty)";
  const rng = opts.random ?? Math.random;
  const byRound = new Map<number, DebateContributionEntry[]>();
  for (const e of entries) {
    const arr = byRound.get(e.round) ?? [];
    arr.push(e);
    byRound.set(e.round, arr);
  }
  const lines: string[] = [];
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const roundEntries = byRound.get(round)!.slice();
    if (opts.shuffle) {
      // Fisher–Yates with the injected RNG.
      for (let i = roundEntries.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = roundEntries[i]!;
        roundEntries[i] = roundEntries[j]!;
        roundEntries[j] = tmp;
      }
    }
    lines.push(`Round ${round}:`);
    for (const entry of roundEntries) {
      if (opts.anonymize) {
        lines.push(`[${entry.stance}] ${entry.text}`);
      } else {
        lines.push(`[${entry.agentName}, ${entry.stance}] ${entry.text}`);
      }
    }
  }
  return lines.join("\n");
}

/** Build the default judge generator. */
export function createJudge(opts: CreateJudgeOptions) {
  const anonymize = opts.anonymizeTranscript ?? true;
  const shuffle = opts.shuffleForJudge ?? true;
  return generator({
    name: `${opts.name}-judge`,
    model: opts.model ?? "intent/synthesize",
    outputSchema: debateVerdictSchema,
    resources: { transcript: opts.transcript },
    sequencerStateSchema: debateStateSchema,
    agentType: opts.agentType ?? "primary",
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
        "You are evaluating a structured debate.",
        "Decide which position is best supported by the strongest arguments.",
        "You may also synthesize a position that combines the strongest",
        "points of multiple stances; in that case set winner=null.",
        "Always cite specific arguments from the transcript in your reasoning.",
        instructionsBlock,
      ]
        .filter(Boolean)
        .join("\n");
    },
    user: async (_input, ctx) => {
      const state = ctx.sequencer!.state;
      const transcriptState = (await ctx.resources.transcript
        ?.state) as DebateTranscriptState | undefined;
      const entries = transcriptState?.entries ?? [];
      const positionsBlock = opts.stances.length > 0
        ? `Positions argued:\n${opts.stances.map((s) => `- ${s}`).join("\n")}`
        : "";
      const transcriptBlock = formatTranscriptForJudge(entries, {
        anonymize,
        shuffle,
        ...(opts.random ? { random: opts.random } : {}),
      });
      return [
        `Question: ${state.question ?? ""}`,
        positionsBlock,
        `Full debate transcript (${state.round} round${state.round === 1 ? "" : "s"}):`,
        transcriptBlock,
      ]
        .filter(Boolean)
        .join("\n\n");
    },
  });
}
