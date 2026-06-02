/**
 * Round Robin pattern — fixed-roster, deterministic-order turn-taking.
 *
 * Each round runs every roster agent in declared order. An optional
 * per-round referee audits the round's contributions for argument quality
 * and emits a critique that subsequent rounds can read; it does not
 * control termination. The loop exits when `maxRounds` is reached or the
 * optional `terminateWhen(ctx)` predicate returns true. A synthesizer
 * runs as the terminal step by default; pass `synthesizer: false` to
 * skip it and return the raw `RoundRobinFinalShape`.
 *
 * Pipeline:
 *   sequencer
 *     .tap(initContributions)    // clear resource + prime task collection
 *     .tap(stampGoal)            // outer state .goal = input.goal
 *     .step(incrementRound)      // round++ — loopBack target
 *     .step(roster[0]).tap(record[0])
 *     ...
 *     .step(roster[N-1]).tap(record[N-1])
 *     [.step(referee).tap(stashRefereeCritique)]   // only when referee is provided
 *     .loopBack(incrementRound, { when: round < maxRounds && !terminateWhen(ctx) })
 *     .map(buildFinalShape)
 *     [.step(synthesizer)]
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type {
  ItemVisibility,
  GeneratorSlot,
  InstructionsSlot,
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
  roundRobinInputSchema,
  roundRobinStateSchema,
  createRoundRobinContributions,
  type RoundRobinContributionsState,
  type RoundRobinFinalShape,
  type RoundRobinInput,
  type RoundRobinRefereeOutput,
  type RoundRobinState,
} from "./schemas";
import { createInitContributions } from "./blocks/init-contributions";
import { createRecordContribution } from "./blocks/record-contribution";
import { createRosterAgent } from "./blocks/default-roster-agent";
import { createSynthesize } from "./blocks/default-synthesizer";

export {
  roundRobinInputSchema,
  roundRobinStateSchema,
  roundRobinContributionEntrySchema,
  roundRobinContributionsStateSchema,
  roundRobinRefereeOutputSchema,
  roundRobinRefereeCritiqueSchema,
  createRoundRobinContributions,
} from "./schemas";
export type {
  RoundRobinInput,
  RoundRobinState,
  RoundRobinContributionEntry,
  RoundRobinContributionsState,
  RoundRobinRefereeOutput,
  RoundRobinRefereeCritique,
  RoundRobinFinalShape,
} from "./schemas";
export { createRosterAgent } from "./blocks/default-roster-agent";
export { createReferee } from "./blocks/default-referee";
export { createSynthesize } from "./blocks/default-synthesizer";
export { createInitContributions } from "./blocks/init-contributions";
export { createRecordContribution } from "./blocks/record-contribution";

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
  /** Default 5. Hard cap on round cycling. */
  maxRounds?: number;
  /**
   * Optional runtime predicate evaluated after each round completes. Return
   * `true` to exit the loop before `maxRounds` is reached. Reads from
   * `ctx.sequencer.state` (round counter, referee critiques) and
   * `ctx.session.state` (consumer-driven termination conditions).
   *
   * Should be a pure, total function. A throwing predicate surfaces as a
   * loop runtime error.
   */
  terminateWhen?: (ctx: BlockContext) => boolean;
  /**
   * Optional shared contributions resource. When omitted, the pattern
   * creates its own internal instance via `createRoundRobinContributions()`.
   *
   * Pass an external instance when consumer blocks outside the pattern need
   * to read the running transcript via `ctx.resources` instead of threading
   * it through `RoundRobinFinalShape.contributions`. Register the shared
   * resource on the flow's `resources` map so external consumers can declare
   * it on their own `resources:` slot.
   */
  contributions?: DefinedResource;
  /**
   * Optional per-round argument-quality auditor. When provided, runs after
   * every roster round; its `{ critique }` output is appended to outer
   * state as a `RoundRobinRefereeCritique` and rendered into subsequent
   * rounds' default roster-agent prompts. Does NOT control termination.
   */
  referee?: BlockDefinition<any, any>;
  /** Terminal synthesis step. Pass `false` to return the raw final shape. */
  synthesizer?: BlockDefinition<any, any> | false;
  /** Output schema applied to the synthesizer's output. */
  outputSchema?: TOutputSchema;
  /** Pattern-level instructions injected into default blocks only. */
  instructions?: InstructionsSlot<RoundRobinInput>;
  /** Default model for internal generators. Default `"intent/chat"`. */
  model?: string;
  /** Capabilities forwarded to default roster agents, referee, synthesizer. */
  uses?: UsesSlot;
  /** Tools forwarded to default roster agents, referee, synthesizer. */
  tools?: ToolsSlot;
  /** Generator context slot forwarded to defaults. */
  context?: GeneratorSlot<any, any>;
  synthesizerVisibility?: ItemVisibility;
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
    terminateWhen,
    instructions,
    model,
    uses,
    tools,
    context,
    synthesizerVisibility,
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

  // Returns the new round number so this is a real `.step()` step (BP-014:
  // never return input as output). The roster agents ignore this input
  // and read goal + round from the outer sequencer state.
  const incrementRound = handler({
    name: `${name}-increment-round`,
    inputSchema: z.any(),
    outputSchema: z.object({ round: z.number() }),
    sequencerStateSchema: roundRobinStateSchema,
    execute: async (_input, ctx) => {
      const state = ctx.sequencer!.state;
      const next = state.round + 1;
      await ctx.sequencer!.patchState({ round: next });
      return { round: next };
    },
  });

  const stashRefereeCritique = handler({
    name: `${name}-stash-referee`,
    inputSchema: z.any(),
    sequencerStateSchema: roundRobinStateSchema,
    execute: async (input, ctx) => {
      const out = input as RoundRobinRefereeOutput;
      const state = ctx.sequencer!.state;
      await ctx.sequencer!.patchState({
        refereeCritiques: [
          ...state.refereeCritiques,
          { round: state.round, critique: out.critique },
        ],
      });
    },
  });

  // Build the pipeline. Start with init + stamp + increment, then chain
  // (roster[i] → record[i]) for each entry, optionally append the referee
  // + stash, then close the loop.
  let pipeline: any = sequencer({
    name,
    inputSchema: roundRobinInputSchema,
    stateSchema: roundRobinStateSchema,
    container: { component: "roundRobin" },
  })
    .tap(initContributions)
    .tap(stampGoal)
    .step(incrementRound);

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
    pipeline = pipeline.step(agentBlock).tap(recordTap);
  }

  if (config.referee !== undefined) {
    pipeline = pipeline.step(config.referee).tap(stashRefereeCritique);
  }

  pipeline = pipeline
    .loopBack(incrementRound.name, {
      when: (_value: unknown, ctx: any) => {
        const state = ctx.sequencer!.state;
        if (state.round >= maxRounds) return false;
        if (terminateWhen !== undefined && terminateWhen(ctx as BlockContext)) {
          return false;
        }
        return true;
      },
      maxIterations: Math.max(0, maxRounds - 1),
    })
    .map((_value: unknown, ctx: any) => {
      const state = ctx.sequencer!.state;
      const contribState = ctx.resources?.[accessorKey]
        ?.state as RoundRobinContributionsState | undefined;
      const final: RoundRobinFinalShape = {
        rounds: state.round,
        contributions: contribState?.entries ?? [],
        refereeCritiques: state.refereeCritiques,
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
      ...(synthesizerVisibility !== undefined
        ? { itemVisibility: synthesizerVisibility }
        : {}),
    });

  return pipeline.step(synth) as SequencerDefinition<any, any>;
}
