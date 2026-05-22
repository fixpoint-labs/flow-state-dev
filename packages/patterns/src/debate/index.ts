/**
 * Debate pattern — multi-round adversarial argumentation with assigned
 * stances and a single judge that runs once at the end.
 *
 * Has two operating modes:
 *
 *   1. **No moderator (default).** Every debater speaks every round in
 *      declared order. The loop terminates at `maxRounds`, or earlier
 *      if `terminateWhen(ctx)` returns true. Identical to historical
 *      behavior.
 *   2. **With a `moderator` block.** The moderator opens each round:
 *      it picks who speaks, can supply a `briefing` (e.g. research
 *      synthesized from tool calls) and a `newAngle` for the round,
 *      and may flag `done: true` to make this round the last. With
 *      the moderator at the top, every decision drives a real round —
 *      there are no orphan decisions before the judge.
 *
 * Pipeline (no moderator):
 *   sequencer
 *     .tap(initTranscript)
 *     .tap(stampQuestion)
 *     .then(incrementRound)                          ← loopBack target
 *     .then(debater[0]).tap(record[0])
 *     ...
 *     .then(debater[N-1]).tap(record[N-1])
 *     .loopBack(incrementRound, { when: round < maxRounds && !terminateWhen })
 *     .then(judge)
 *     .map(buildRawOutput)
 *     [.then(synthesizer)]
 *
 * Pipeline (with moderator):
 *   sequencer
 *     .tap(initTranscript)
 *     .tap(stampQuestion)
 *     .then(incrementRound)                          ← loopBack target
 *     .then(moderator).tap(stashModeratorDecision)   // opens the round
 *     .forEach(speakersForRound, dispatchByName, { maxConcurrency: 1 })
 *     .loopBack(incrementRound, { when: round < maxRounds && !last.done && !terminateWhen })
 *     .then(judge)
 *     .map(buildRawOutput)
 *     [.then(synthesizer)]
 */
import { sequencer, handler, utility } from "@flow-state-dev/core";
import type {
  AgentType,
  GeneratorSlot,
  SequencerDefinition,
  ToolsSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import type {
  BlockContext,
  BlockDefinition,
  DefinedResource,
} from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import {
  debateInputSchema,
  debateStateSchema,
  createDebateTranscript,
  type DebateModeratorOutput,
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
  debateModeratorOutputSchema,
  debateModeratorDecisionSchema,
  createDebateTranscript,
} from "./schemas";
export type {
  DebateInput,
  DebateState,
  DebateContributionEntry,
  DebateVerdict,
  DebateTranscriptState,
  DebateRawOutput,
  DebateModeratorOutput,
  DebateModeratorDecision,
} from "./schemas";
export { createDebater } from "./blocks/default-debater";
export { createJudge, formatTranscriptForJudge } from "./blocks/default-judge";
export { createSynthesize } from "./blocks/default-synthesizer";
export { createModerator } from "./blocks/default-moderator";
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
  /**
   * Optional moderator block. When provided, opens each round: it picks
   * which debaters speak that round, may supply a `briefing` and
   * `newAngle` that those debaters see, and may set `done: true` to
   * make this the last round (the round still runs; the loop exits
   * after). Sees the full transcript of all PRIOR rounds — the current
   * round's speakers haven't run yet when the moderator decides. When
   * omitted, the debate runs in fixed declared-roster order — every
   * debater every round.
   *
   * Pass `false` is NOT permitted; use `undefined` to opt out.
   */
  moderator?: BlockDefinition<any, any>;
  /**
   * Optional shared transcript resource. When omitted, the pattern
   * creates its own internal instance via `createDebateTranscript()`.
   *
   * Pass an external instance when a custom `moderator`, `judge`, or
   * `synthesizer` block declares the same transcript resource on its
   * own `resources:` slot — they must share the resource reference,
   * otherwise the framework's resource-merge rejects two
   * `defineResource()` instances declared against the same key.
   */
  transcript?: DefinedResource;
  /**
   * Optional runtime predicate evaluated after each round completes.
   * Return true to exit the loop before `maxRounds` is reached. Useful
   * for session-state-driven early exits independent of the moderator.
   *
   * Should be a pure, total function. A throwing predicate surfaces as
   * a loop runtime error.
   */
  terminateWhen?: (ctx: BlockContext) => boolean;
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
    terminateWhen,
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
  if ((config.moderator as unknown) === false) {
    throw new Error(
      `[debate] moderator cannot be set to false in "${name}" — use undefined to opt out`,
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
  const transcript = config.transcript ?? createDebateTranscript();
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
      const state = ctx.sequencer!.state;
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

  /**
   * Live-progress hint emitted before each debater starts. Renderers
   * use it to draw a "{agentName} is composing..." row so the UI
   * doesn't sit silent during the debater's tool loop and content
   * generation. Persisted (not transient) so React clients that
   * default `useSession({ includeTransient: false })` still receive
   * it — the renderer hides the pending row once the matching
   * persisted `debate-turn` lands via count-matching.
   */
  const makePendingTurnTap = (agentName: string, stance: string) =>
    handler({
      name: `${name}-pending-${agentName}`,
      inputSchema: z.any(),
      sequencerStateSchema: debateStateSchema,
      execute: (_input, ctx) => {
        const state = ctx.sequencer!.state;
        ctx.emit.component("debate-turn-pending", {
          round: state.round,
          agentName,
          stance,
        });
      },
    });

  // Emit the judge's verdict as a renderable component item right after
  // the judge runs, so the closing card streams into the debate
  // container before the synthesizer (if any) projects to a final shape.
  const emitVerdictTap = handler({
    name: `${name}-emit-verdict`,
    inputSchema: z.any(),
    execute: (input, ctx) => {
      const verdict = input as DebateVerdict;
      ctx.emit.component(
        "debate-verdict",
        {
          verdict: verdict.verdict,
          winner: verdict.winner,
          reasoning: verdict.reasoning,
        },
        { key: "verdict" },
      );
    },
  });

  const buildRawOutput = (value: unknown, ctx: any): DebateRawOutput => {
    const state = ctx.sequencer!.state as DebateState;
    const transcriptState = ctx.resources?.transcript
      ?.state as DebateTranscriptState | undefined;
    return {
      rounds: state.round,
      question: state.question,
      transcript: transcriptState?.entries ?? [],
      verdict: value as DebateVerdict,
      moderatorDecisions: state.moderatorDecisions ?? [],
    };
  };

  const finalize = (
    pipeline: any,
    judge: BlockDefinition<any, any>,
  ): SequencerDefinition<any, any> => {
    const withJudge = pipeline
      .then(judge)
      .tap(emitVerdictTap)
      .map((value: unknown, ctx: any) => buildRawOutput(value, ctx));
    if (config.synthesizer === false) {
      return withJudge as SequencerDefinition<any, any>;
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
    return withJudge.then(synth) as SequencerDefinition<any, any>;
  };

  // ---------------------------------------------------------------------
  // Path 1: no moderator — preserved historical pipeline (plus terminateWhen).
  // ---------------------------------------------------------------------
  if (config.moderator === undefined) {
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
          ...(debaterAgentType !== undefined
            ? { agentType: debaterAgentType }
            : {}),
        });
      const recordTap = createRecordArgument({
        name,
        agentName: entry.name,
        stance: entry.stance,
        transcript,
        collectionId,
        warnedAgents,
      });
      pipeline = pipeline
        .tap(makePendingTurnTap(entry.name, entry.stance))
        .then(debaterBlock)
        .tap(recordTap);
    }

    pipeline = pipeline.loopBack(incrementRound.name, {
      when: (_out: unknown, ctx: any) => {
        const state = ctx.sequencer!.state as DebateState;
        if (state.round >= maxRounds) return false;
        if (
          terminateWhen !== undefined &&
          terminateWhen(ctx as BlockContext)
        ) {
          return false;
        }
        return true;
      },
      maxIterations: Math.max(0, maxRounds - 1),
    });

    return finalize(pipeline, judgeBlock);
  }

  // ---------------------------------------------------------------------
  // Path 2: with moderator — dynamic per-round dispatch.
  // ---------------------------------------------------------------------

  // Build per-debater sub-sequencers (debater + recordTap) up front and
  // index them by debater name. `.forEach`'s factory picks the right
  // sub-sequencer for each moderator-named speaker.
  //
  // IMPORTANT: the per-speaker sub-sequencer must NOT declare a
  // `stateSchema`. `ctx.sequencer` resolution walks the parent chain
  // looking for a sequencer whose `parentStateContainer` is set, and
  // that container is only created when the sequencer declared a
  // `stateSchema`. Omitting it here keeps the inner sub-sequencer
  // transparent so `recordTap`'s `ctx.sequencer` resolves to the outer
  // debate sequencer (where `round` lives and the task collection is
  // backed).
  const speakerBlocks: Record<string, BlockDefinition<any, any>> = {};
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
        ...(debaterAgentType !== undefined
          ? { agentType: debaterAgentType }
          : {}),
      });
    const recordTap = createRecordArgument({
      name,
      agentName: entry.name,
      stance: entry.stance,
      transcript,
      collectionId,
      warnedAgents,
    });
    const speakerStep = sequencer({
      name: `${name}-speaker-${entry.name}`,
      inputSchema: z.any(),
    })
      .tap(makePendingTurnTap(entry.name, entry.stance))
      .then(debaterBlock)
      .tap(recordTap);
    speakerBlocks[entry.name] = speakerStep as BlockDefinition<any, any>;
  }

  const stashModeratorDecision = handler({
    name: `${name}-stash-moderator`,
    inputSchema: z.any(),
    sequencerStateSchema: debateStateSchema,
    execute: async (input, ctx) => {
      const out = input as DebateModeratorOutput;
      const state = ctx.sequencer!.state;
      const decision = {
        round: state.round,
        nextSpeakers: out.nextSpeakers,
        briefing: out.briefing,
        newAngle: out.newAngle,
        done: out.done,
      };
      await ctx.sequencer!.patchState({
        moderatorDecisions: [...state.moderatorDecisions, decision],
      });

      // Renderable snapshot of the moderator's decision. The renderer
      // shows this as the opener of the round.
      ctx.emit.component("debate-decision", decision, {
        key: `decision-${state.round}`,
      });
    },
  });

  // The moderator runs at the top of every round and stashes the decision
  // BEFORE this connector fires, so the freshly-appended decision is the
  // one for the current round. Match on the round number explicitly to
  // stay robust if the loop order ever changes.
  const speakersForRound = (_input: unknown, ctx: BlockContext): string[] => {
    const state = ctx.sequencer!.state as DebateState;
    const decisions = state.moderatorDecisions ?? [];
    const current = decisions.find((d) => d.round === state.round);
    if (current) return current.nextSpeakers;
    // Defensive fallback if the moderator's decision is somehow missing —
    // e.g. a custom moderator that returned an empty list with done=true:
    // use the declared roster so we don't blow up on .forEach over [].
    return debaters.map((d) => d.name);
  };

  // Per-iteration dispatch by debater name. The forEach feeds each
  // speaker name as the router's input; `utility.keyedRouter` looks
  // the name up in `speakerBlocks` and throws (with the registered
  // list) if the moderator returned an unknown debater.
  const dispatchByName = utility.keyedRouter({
    name: `${name}-dispatch-speaker`,
    blocks: speakerBlocks,
    select: (speakerName: string) => speakerName,
  });

  let pipeline: any = sequencer({
    name,
    inputSchema: debateInputSchema,
    stateSchema: debateStateSchema,
    container: { component: "debate" },
  })
    .tap(initTranscript)
    .tap(stampQuestion)
    .then(incrementRound)
    // Moderator opens each round: it picks speakers, optionally supplies
    // a briefing and angle for the debaters, and may flag this as the
    // last round. With the moderator at the top, every decision drives
    // a real round — there are no orphan decisions before the judge.
    .then(config.moderator)
    .tap(stashModeratorDecision)
    // `maxConcurrency: 1` is load-bearing: it makes within-round speakers
    // sequential, so later speakers see the freshly recorded transcript
    // entries of earlier ones. Without it `.forEach` defaults to parallel.
    .forEach(speakersForRound as any, dispatchByName as any, {
      maxConcurrency: 1,
    })
    .loopBack(incrementRound.name, {
      when: (_out: unknown, ctx: any) => {
        const state = ctx.sequencer!.state as DebateState;
        if (state.round >= maxRounds) return false;
        const decisions = state.moderatorDecisions ?? [];
        const last =
          decisions.length > 0 ? decisions[decisions.length - 1]! : undefined;
        if (last !== undefined && last.done) return false;
        if (
          terminateWhen !== undefined &&
          terminateWhen(ctx as BlockContext)
        ) {
          return false;
        }
        return true;
      },
      maxIterations: Math.max(0, maxRounds - 1),
    });

  return finalize(pipeline, judgeBlock);
}
