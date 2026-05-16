/**
 * Round Robin pattern — fixed-roster, deterministic-order turn-taking
 * with a judge as the loop terminator.
 *
 * Each round runs every roster agent in declared order. After the round
 * completes, a judge inspects the transcript and returns
 * `{ done, summary }`. The pattern cycles until the judge sets
 * `done: true` or `maxRounds` is reached.
 *
 * Pipeline:
 *   sequencer
 *     .tap(initContributions)    // clear resource + prime task collection
 *     .tap(stampGoal)            // outer state .goal = input.goal
 *     .tap(incrementRound)       // round++ — loopBack target
 *     .then(roster[0]).tap(record[0])
 *     ...
 *     .then(roster[N-1]).tap(record[N-1])
 *     .then(judge)               // → { done, summary }
 *     .tap(stashJudgeVerdict)    // patch outer state
 *     .loopBack(incrementRound, { when: !done, maxIterations: maxRounds-1 })
 *     .map(buildFinalShape)
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
import type {
  BlockDefinition,
  DefinedResource,
} from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import {
  roundRobinInputSchema,
  roundRobinStateSchema,
  createRoundRobinContributions,
  type RoundRobinContributionsState,
  type RoundRobinFinalShape,
  type RoundRobinJudgeOutput,
  type RoundRobinState,
} from "./schemas";
import { createInitContributions } from "./blocks/init-contributions";
import { createRecordContribution } from "./blocks/record-contribution";
import { createRosterAgent } from "./blocks/default-roster-agent";
import { createJudge } from "./blocks/default-judge";
import { createSynthesize } from "./blocks/default-synthesizer";

export {
  roundRobinInputSchema,
  roundRobinStateSchema,
  roundRobinContributionEntrySchema,
  roundRobinJudgeOutputSchema,
  roundRobinContributionsStateSchema,
  createRoundRobinContributions,
} from "./schemas";
export type {
  RoundRobinInput,
  RoundRobinState,
  RoundRobinContributionEntry,
  RoundRobinJudgeOutput,
  RoundRobinContributionsState,
  RoundRobinFinalShape,
} from "./schemas";
export { createRosterAgent } from "./blocks/default-roster-agent";
export { createJudge } from "./blocks/default-judge";
export { createSynthesize } from "./blocks/default-synthesizer";
export { createInitContributions } from "./blocks/init-contributions";
export { createRecordContribution } from "./blocks/record-contribution";

type InstructionsSlot =
  | string
  | ((input: any, ctx: any) => string | Promise<string>);

/** A single seat in the round-robin roster. */
export interface RosterEntry {
  /**
   * Stable name used for context attribution and as the audit task's
   * `assignee`. Must be unique within a roster.
   */
  name: string;
  /**
   * Role description injected into the default roster agent's prompt
   * (e.g. "aggressive risk reviewer"). Ignored if `block` is provided.
   */
  role?: string;
  /**
   * Optional override block. Replaces the default LLM agent. Must
   * produce a string or `{ text: string }`; other shapes are coerced
   * via `String()` and a one-time warning is emitted.
   */
  block?: BlockDefinition<any, any>;
}

export interface RoundRobinConfig<
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> {
  name: string;
  roster: RosterEntry[];
  /** Default 5. Hard cap on round cycling regardless of judge verdict. */
  maxRounds?: number;
  /**
   * Optional shared contributions resource. When omitted, the pattern
   * creates its own internal instance via `createRoundRobinContributions()`.
   *
   * Pass an external instance when:
   * - Multiple `roundRobin()` instances need to share state — e.g. behind
   *   a `router()` that picks one at runtime. The pattern allocates the
   *   resource per call, so without a shared reference the router's
   *   resource-merge would reject with `Resource conflict: "contributions"`.
   * - Consumer blocks outside the pattern need to read the running
   *   transcript via `ctx.resources` instead of threading it through
   *   `RoundRobinFinalShape.contributions`.
   *
   * Register the shared resource on the flow's `resources` map so
   * external consumers can declare it on their own `resources:` slot.
   */
  contributions?: DefinedResource;
  /**
   * Judge override. Must produce `{ done: boolean, summary: string }`.
   * Pass `false` is NOT permitted — Round Robin requires a terminator.
   * Use a stub judge that always returns `{ done: false }` to lean on
   * `maxRounds`.
   */
  judge?: BlockDefinition<any, any>;
  /** Optional final synthesizer. Pass `false` to return the raw final shape. */
  synthesizer?: BlockDefinition<any, any> | false;
  /** Output schema applied to the synthesizer's output. */
  outputSchema?: TOutputSchema;
  /** Pattern-level instructions injected into default blocks only. */
  instructions?: InstructionsSlot;
  /** Default model for internal generators. Default `"intent/chat"`. */
  model?: string;
  /** Capabilities forwarded to default roster agents, judge, synthesizer. */
  uses?: UsesSlot;
  /** Tools forwarded to default roster agents, judge, synthesizer. */
  tools?: ToolsSlot;
  /** Generator context slot forwarded to defaults. */
  context?: GeneratorSlot<any, any>;
  judgeAgentType?: AgentType;
  synthesizerAgentType?: AgentType;
  /** Stable id for the audit `TaskCollection`. Defaults to `name`. */
  collectionId?: string;
  /**
   * Accessor key the pattern's internal blocks use to declare the
   * contributions resource. Defaults to `"contributions"`.
   *
   * Override when two or more `roundRobin()` instances appear in the
   * same sequencer chain: the framework's resource-merge rejects the
   * same accessor key pointing at different `defineResource()`
   * references, so each instance must pick a distinct key (e.g.
   * `"p2Contributions"`, `"p4Contributions"`).
   */
  accessorKey?: string;
}

/**
 * Build a Round Robin coordination pattern. Returns a sequencer block
 * that takes `{ goal: string }` and returns the synthesizer's output
 * (or `RoundRobinFinalShape` if `synthesizer: false`).
 */
export function roundRobin<TOutputSchema extends ZodTypeAny = ZodTypeAny>(
  config: RoundRobinConfig<TOutputSchema>,
): SequencerDefinition<any, any> {
  const {
    name,
    roster,
    maxRounds = 5,
    instructions,
    model,
    uses,
    tools,
    context,
    judgeAgentType,
    synthesizerAgentType,
    outputSchema,
  } = config;

  if (!Array.isArray(roster) || roster.length === 0) {
    throw new Error(`[round-robin] roster must contain at least 1 entry in "${name}"`);
  }
  const seen = new Set<string>();
  for (const entry of roster) {
    if (!entry.name || typeof entry.name !== "string") {
      throw new Error(`[round-robin] every roster entry needs a non-empty name in "${name}"`);
    }
    if (seen.has(entry.name)) {
      throw new Error(
        `[round-robin] duplicate roster name "${entry.name}" in "${name}"`,
      );
    }
    seen.add(entry.name);
  }
  if (maxRounds <= 0) {
    throw new Error(`[round-robin] maxRounds must be > 0 in "${name}"`);
  }
  if (config.synthesizer === false && outputSchema !== undefined) {
    throw new Error(
      `[round-robin] cannot set outputSchema when synthesizer: false in "${name}"`,
    );
  }

  const collectionId = config.collectionId ?? name;
  const accessorKey = config.accessorKey ?? "contributions";
  const contributions = config.contributions ?? createRoundRobinContributions();
  const warnedAgents = new Set<string>();

  const initContributions = createInitContributions({
    name,
    contributions,
    collectionId,
    accessorKey,
  });

  const stampGoal = handler({
    name: `${name}-stamp-goal`,
    inputSchema: roundRobinInputSchema,
    sequencerStateSchema: roundRobinStateSchema,
    execute: async (input, ctx) => {
      await ctx.sequencer!.patchState({ goal: input.goal });
    },
  });

  // Returns the new round number so this is a real `.then()` step (BP-014:
  // never return input as output). The roster agents ignore this input
  // and read goal + round from the outer sequencer state.
  const incrementRound = handler({
    name: `${name}-increment-round`,
    inputSchema: z.any(),
    outputSchema: z.object({ round: z.number() }),
    sequencerStateSchema: roundRobinStateSchema,
    execute: async (_input, ctx) => {
      const state = ctx.sequencer!.state as RoundRobinState;
      const next = state.round + 1;
      await ctx.sequencer!.patchState({ round: next });
      return { round: next };
    },
  });

  const judgeBlock =
    config.judge ??
    createJudge({
      name,
      contributions,
      accessorKey,
      ...(model !== undefined ? { model } : {}),
      ...(context !== undefined ? { context } : {}),
      ...(uses !== undefined ? { uses } : {}),
      ...(tools !== undefined ? { tools } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      ...(judgeAgentType !== undefined ? { agentType: judgeAgentType } : {}),
    });

  const stashJudgeVerdict = handler({
    name: `${name}-stash-judge`,
    inputSchema: z.any(),
    sequencerStateSchema: roundRobinStateSchema,
    execute: async (input, ctx) => {
      const verdict = input as RoundRobinJudgeOutput;
      await ctx.sequencer!.patchState({
        done: verdict.done,
        lastJudgeSummary: verdict.summary ?? "",
      });
    },
  });

  // Build the pipeline. Start with init + stamp + increment, then chain
  // (roster[i] → record[i]) for each entry, then judge + stash.
  let pipeline: any = sequencer({
    name,
    inputSchema: roundRobinInputSchema,
    stateSchema: roundRobinStateSchema,
    container: { component: "roundRobin" },
  })
    .tap(initContributions)
    .tap(stampGoal)
    .then(incrementRound);

  for (const entry of roster) {
    const agentBlock =
      entry.block ??
      createRosterAgent({
        name,
        agentName: entry.name,
        ...(entry.role !== undefined ? { role: entry.role } : {}),
        contributions,
        accessorKey,
        ...(model !== undefined ? { model } : {}),
        ...(context !== undefined ? { context } : {}),
        ...(uses !== undefined ? { uses } : {}),
        ...(tools !== undefined ? { tools } : {}),
        ...(instructions !== undefined ? { instructions } : {}),
      });
    const recordTap = createRecordContribution({
      name,
      agentName: entry.name,
      contributions,
      collectionId,
      warnedAgents,
      accessorKey,
    });
    pipeline = pipeline.then(agentBlock).tap(recordTap);
  }

  pipeline = pipeline
    .then(judgeBlock)
    .tap(stashJudgeVerdict)
    .loopBack(incrementRound.name, {
      when: (out: any) => !(out as RoundRobinJudgeOutput).done,
      maxIterations: Math.max(0, maxRounds - 1),
    })
    .map((_value: unknown, ctx: any) => {
      const state = ctx.sequencer!.state as RoundRobinState;
      const contribState = ctx.resources?.[accessorKey]
        ?.state as RoundRobinContributionsState | undefined;
      const final: RoundRobinFinalShape = {
        rounds: state.round,
        done: state.done,
        summary: state.lastJudgeSummary ?? "",
        contributions: contribState?.entries ?? [],
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
