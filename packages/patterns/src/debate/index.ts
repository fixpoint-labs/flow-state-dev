/**
 * Debate pattern — multi-round adversarial argumentation with assigned
 * stances and a single judge that runs once at the end.
 *
 * Built on the same chassis as Round Robin (FIX-318) with three
 * structural specializations: each debater carries an assigned `stance`
 * the prompt forbids them from conceding, every debater sees ALL prior
 * arguments from ALL agents (including same-round earlier speakers),
 * and the judge runs OUTSIDE the round loop — after `maxRounds` rounds
 * have completed — instead of as the per-round terminator.
 *
 * Pipeline:
 *   sequencer
 *     .tap(initTranscript)            // clear resource + prime task collection
 *     .tap(stampQuestion)             // outer state .question = input.question
 *     .tap(incrementRound)            // round++ — loopBack target
 *     .then(debater[0]).tap(record[0])
 *     ...
 *     .then(debater[N-1]).tap(record[N-1])
 *     .loopBack(incrementRound, { when: round < maxRounds, maxIterations: maxRounds-1 })
 *     .then(judge)                    // OUTSIDE the loop; sees full transcript
 *     .map(buildRawOutput)            // → DebateRawOutput
 *     [.then(synthesizer)]
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type {
  AgentType,
  GeneratorSlot,
  SequencerDefinition,
  ToolsSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import {
  debateInputSchema,
  debateStateSchema,
  createDebateTranscript,
  type DebateRawOutput,
  type DebateState,
  type DebateTranscriptState,
  type DebateVerdict,
} from "./schemas";
import { createInitTranscript } from "./blocks/init-transcript";
import { createRecordArgument } from "./blocks/record-argument";
import { createDebater } from "./blocks/default-debater";
import { createJudge } from "./blocks/default-judge";
import { createSynthesize } from "./blocks/default-synthesizer";

export {
  debateInputSchema,
  debateStateSchema,
  debateContributionEntrySchema,
  debateVerdictSchema,
  debateTranscriptStateSchema,
  createDebateTranscript,
} from "./schemas";
export type {
  DebateInput,
  DebateState,
  DebateContributionEntry,
  DebateVerdict,
  DebateTranscriptState,
  DebateRawOutput,
} from "./schemas";
export { createDebater } from "./blocks/default-debater";
export { createJudge, formatTranscriptForJudge } from "./blocks/default-judge";
export { createSynthesize } from "./blocks/default-synthesizer";
export { createInitTranscript } from "./blocks/init-transcript";
export { createRecordArgument } from "./blocks/record-argument";

type InstructionsSlot =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

/** A single debater seat. */
export interface DebaterConfig {
  /**
   * Stable name used for attribution and as the audit task's
   * `assignee`. Must be unique within the debaters array.
   */
  name: string;
  /**
   * Assigned position the debater argues. Required — Debate does not
   * derive stances from the question.
   */
  stance: string;
  /**
   * Optional persona description injected into the default debater's
   * prompt (e.g. "skeptical engineer"). Ignored if `block` is provided.
   */
  role?: string;
  /**
   * Optional override block. Replaces the default LLM debater. Must
   * produce a string or `{ text: string }`; other shapes are coerced
   * via `String()` and a one-time warning is emitted.
   */
  block?: BlockDefinition<any, any>;
}

export interface DebateConfig<TOutputSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  /** At least 2 entries required; each `name` must be unique. */
  debaters: DebaterConfig[];
  /** Default 2. >4 emits a one-time warning about diminishing returns. */
  maxRounds?: number;
  /**
   * Judge override. Receives `{ question }` (and reads the transcript
   * resource) and must produce
   * `{ verdict: string, winner: string | null, reasoning: string }`.
   * Pass `false` is NOT permitted — the verdict is Debate's identity.
   */
  judge?: BlockDefinition<any, any>;
  /** Optional final synthesizer. Pass `false` to return the raw shape. */
  synthesizer?: BlockDefinition<any, any> | false;
  outputSchema?: TOutputSchema;
  /** Pattern-level instructions injected into default blocks only. */
  instructions?: InstructionsSlot;
  /** Default model for internal generators. */
  model?: string;
  uses?: UsesSlot;
  tools?: ToolsSlot;
  context?: GeneratorSlot<any, any>;
  judgeAgentType?: AgentType;
  synthesizerAgentType?: AgentType;
  debaterAgentType?: AgentType;
  /**
   * Strip debater names from the judge's view of the transcript.
   * Stances are retained. Default `true`. Mitigates identity-driven
   * self-bias when the judge model is the same as a debater model.
   */
  anonymizeTranscript?: boolean;
  /**
   * Shuffle argument order within each round when rendered for the
   * judge. Default `true`. Mitigates LLM-judge position bias.
   */
  shuffleForJudge?: boolean;
  /** Stable id for the audit `TaskCollection`. Defaults to `name`. */
  collectionId?: string;
}

/**
 * Build a Debate coordination pattern. Returns a sequencer block that
 * takes `{ question: string }` and returns the synthesizer's output
 * (or `DebateRawOutput` if `synthesizer: false`).
 */
export function debate<TOutputSchema extends ZodTypeAny = ZodTypeAny>(
  config: DebateConfig<TOutputSchema>,
): SequencerDefinition<any, any> {
  const {
    name,
    debaters,
    maxRounds = 2,
    instructions,
    model,
    uses,
    tools,
    context,
    judgeAgentType,
    synthesizerAgentType,
    debaterAgentType,
    anonymizeTranscript = true,
    shuffleForJudge = true,
    outputSchema,
  } = config;

  if (!Array.isArray(debaters) || debaters.length < 2) {
    throw new Error(`[debate] debaters must contain at least 2 entries in "${name}"`);
  }
  const seen = new Set<string>();
  for (const entry of debaters) {
    if (!entry.name || typeof entry.name !== "string") {
      throw new Error(`[debate] every debater needs a non-empty name in "${name}"`);
    }
    if (!entry.stance || typeof entry.stance !== "string") {
      throw new Error(
        `[debate] debater "${entry.name}" needs a non-empty stance in "${name}"`,
      );
    }
    if (seen.has(entry.name)) {
      throw new Error(
        `[debate] duplicate debater name "${entry.name}" in "${name}"`,
      );
    }
    seen.add(entry.name);
  }
  if (maxRounds <= 0) {
    throw new Error(`[debate] maxRounds must be > 0 in "${name}"`);
  }
  if (maxRounds > 4) {
    // One-time warning per factory call. Not blocking.
    // eslint-disable-next-line no-console
    console.warn(
      `[debate] maxRounds=${maxRounds} in "${name}" is unusually high; ` +
        `debates beyond ~3 rounds risk sycophantic convergence and rapid token growth.`,
    );
  }
  if (config.synthesizer === false && outputSchema !== undefined) {
    throw new Error(
      `[debate] cannot set outputSchema when synthesizer: false in "${name}"`,
    );
  }
  if (config.judge === undefined && anonymizeTranscript === false && model !== undefined) {
    // eslint-disable-next-line no-console
    console.warn(
      `[debate] anonymizeTranscript: false in "${name}" — if the judge model ` +
        `matches a debater model, identity-driven self-bias may inflate the verdict.`,
    );
  }

  const collectionId = config.collectionId ?? name;
  const transcript = createDebateTranscript();
  const warnedAgents = new Set<string>();
  const stances = debaters.map((d) => d.stance);

  const initTranscript = createInitTranscript({
    name,
    transcript,
    collectionId,
  });

  const stampQuestion = handler({
    name: `${name}-stamp-question`,
    inputSchema: debateInputSchema,
    sequencerStateSchema: debateStateSchema,
    execute: async (input, ctx) => {
      await ctx.sequencer!.patchState({ question: input.question });
    },
  });

  // Returns the new round number so this is a real `.then()` step
  // (BP-014: never return input as output). Debaters ignore this input
  // and read question + round from the outer sequencer state.
  const incrementRound = handler({
    name: `${name}-increment-round`,
    inputSchema: z.any(),
    outputSchema: z.object({ round: z.number() }),
    sequencerStateSchema: debateStateSchema,
    execute: async (_input, ctx) => {
      const state = ctx.sequencer!.state as DebateState;
      const next = state.round + 1;
      await ctx.sequencer!.patchState({ round: next });
      return { round: next };
    },
  });

  const judgeBlock =
    config.judge ??
    createJudge({
      name,
      transcript,
      stances,
      anonymizeTranscript,
      shuffleForJudge,
      ...(model !== undefined ? { model } : {}),
      ...(context !== undefined ? { context } : {}),
      ...(uses !== undefined ? { uses } : {}),
      ...(tools !== undefined ? { tools } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      ...(judgeAgentType !== undefined ? { agentType: judgeAgentType } : {}),
    });

  let pipeline: any = sequencer({
    name,
    inputSchema: debateInputSchema,
    stateSchema: debateStateSchema,
    container: { component: "debate" },
  })
    .tap(initTranscript)
    .tap(stampQuestion)
    .then(incrementRound);

  for (const entry of debaters) {
    const debaterBlock =
      entry.block ??
      createDebater({
        name,
        agentName: entry.name,
        stance: entry.stance,
        ...(entry.role !== undefined ? { role: entry.role } : {}),
        maxRounds,
        transcript,
        ...(model !== undefined ? { model } : {}),
        ...(context !== undefined ? { context } : {}),
        ...(uses !== undefined ? { uses } : {}),
        ...(tools !== undefined ? { tools } : {}),
        ...(instructions !== undefined ? { instructions } : {}),
        ...(debaterAgentType !== undefined ? { agentType: debaterAgentType } : {}),
      });
    const recordTap = createRecordArgument({
      name,
      agentName: entry.name,
      stance: entry.stance,
      transcript,
      collectionId,
      warnedAgents,
    });
    pipeline = pipeline.then(debaterBlock).tap(recordTap);
  }

  pipeline = pipeline
    .loopBack(incrementRound.name, {
      when: (_out: unknown, ctx: any) =>
        (ctx.sequencer!.state as DebateState).round < maxRounds,
      maxIterations: Math.max(0, maxRounds - 1),
    })
    .then(judgeBlock)
    .map((value: unknown, ctx: any) => {
      const state = ctx.sequencer!.state as DebateState;
      const transcriptState = ctx.resources?.transcript
        ?.state as DebateTranscriptState | undefined;
      const final: DebateRawOutput = {
        rounds: state.round,
        question: state.question,
        transcript: transcriptState?.entries ?? [],
        verdict: value as DebateVerdict,
      };
      return final;
    });

  if (config.synthesizer === false) {
    return pipeline as SequencerDefinition<any, any>;
  }

  const synth =
    config.synthesizer ??
    createSynthesize({
      name,
      ...(outputSchema !== undefined ? { outputSchema } : {}),
      ...(context !== undefined ? { context } : {}),
      ...(uses !== undefined ? { uses } : {}),
      ...(tools !== undefined ? { tools } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(synthesizerAgentType !== undefined
        ? { agentType: synthesizerAgentType }
        : {}),
    });

  return pipeline.then(synth) as SequencerDefinition<any, any>;
}
