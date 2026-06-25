/**
 * Thinking-style router factory — the reusable construction (config → router).
 *
 * `createThinkingStyleRouter` builds the six pipelines (default + the five
 * routed styles) and the router that dispatches between them based on
 * `session.state.thinkingStyle`. It's dependency-free of the chat-agent's
 * concrete wiring — the assembled instance lives in `index.ts`. Splitting the
 * factory out keeps the per-pattern wiring in one place and lets worker
 * generators take a different capability/context bundle from the coordinators.
 *
 * The two trivial pipelines (plan-and-execute, moderated-debate) are inlined
 * here — they add no custom blocks, just pattern config. The three that define
 * bespoke generators/handlers keep their own `pipelines/` modules.
 */
import { router } from "@flow-state-dev/core";
import type {
  GeneratorHistoryConfig,
  GeneratorSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";

import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";
import {
  debate,
  createModerator,
  createDebateTranscript,
} from "@flow-state-dev/patterns/debate";

import type { InstructionsSlot, PipelineConfig } from "./pipelines/config";
import { createSupervisorPipeline } from "./pipelines/supervisor";
import { createRoutedSpecialistsPipeline } from "./pipelines/routed-specialists";
import { createEventedActorsPipeline } from "./pipelines/evented-actors";

export interface ThinkingStyleRouterConfig {
  assistantGenerator: BlockDefinition<any, any>;
  /** Model ID string or a selectModel() resolver. */
  modelId: string | ((input: any, ctx: any) => any);
  history?: GeneratorHistoryConfig<any, any>;
  context: GeneratorSlot<any, any>;
  /** Capabilities to install on all default pattern blocks. */
  uses?: UsesSlot;
  /**
   * Capabilities for sub-agent worker generators (supervisor worker,
   * routed-specialists, evented-actor explorer/analyst/challenger). Defaults
   * to `uses`. Split this out to give workers a different capability bundle —
   * e.g. memory's `worker` preset (recall tool only, no formatter) — while
   * pattern coordinators keep the agent bundle.
   */
  workerUses?: UsesSlot;
  /**
   * Context bundle for sub-agent worker generators. Defaults to `context`.
   * Pair with `workerUses` to drop entries that the worker preset would
   * otherwise omit (e.g. the memory formatter).
   */
  workerContext?: GeneratorSlot<any, any>;
  /** Overall instructions passed to pattern sub-blocks (planner, controller, synthesizer). */
  instructions?: InstructionsSlot;
}

// ---------------------------------------------------------------------------
// Trivial pipelines — pure pattern-config wrappers, inlined here.
// ---------------------------------------------------------------------------

/** Build the `pae-thinking` pipeline from the resolved router config. */
function createPaePipeline(config: PipelineConfig) {
  return planAndExecute({
    name: "pae-thinking",
    model: config.modelId as any,
    instructions: config.instructions,
    context: config.context,
    history: config.history,
    search: true,
    uses: config.uses,
    enableReplanning: true,
  });
}

/**
 * Build the `kitchen-sink-debate` pipeline from the resolved router config.
 *
 * The debaters are configured by `stance` / `role` (not custom prompt files),
 * and the pattern's default synthesizer projects the raw debate output into a
 * single primary-agent response — so there's no bespoke block to define.
 */
function createDebatePipeline(config: PipelineConfig) {
  const { modelId, context, workerContext, uses, workerUses, instructions } = config;

  const debateTranscript = createDebateTranscript();
  const debateRosterNames = ["advocate", "skeptic"] as const;

  return debate({
    name: "kitchen-sink-debate",
    transcript: debateTranscript,
    debaters: [
      {
        name: "advocate",
        stance: "Argue for the proposition.",
        role: "Argues in favor of the proposition under discussion.",
      },
      {
        name: "skeptic",
        stance: "Argue against the proposition.",
        role: "Argues against the proposition under discussion.",
      },
    ],
    maxRounds: 2,
    model: modelId as any,
    moderator: createModerator({
      name: "kitchen-sink-debate",
      rosterNames: [...debateRosterNames],
      transcript: debateTranscript,
      ...(modelId !== undefined ? { model: modelId as any } : {}),
      context: workerContext,
      ...(workerUses ? { uses: workerUses as any } : {}),
    }),
    context,
    ...(uses ? { uses: uses as any } : {}),
    instructions,
  });
}

/**
 * Build the thinking-style router and its pipelines from `config`. The
 * `assistantGenerator` is reused as the `default` pipeline; the other five are
 * built by `createPaePipeline` / `createDebatePipeline` (above) and the
 * per-pattern builders in `pipelines/`.
 */
export function createThinkingStyleRouter(config: ThinkingStyleRouterConfig) {
  const { assistantGenerator, modelId, context, uses, instructions } = config;
  const workerUses = config.workerUses ?? uses;
  const workerContext = config.workerContext ?? context;

  const pipelineConfig: PipelineConfig = {
    modelId,
    context,
    workerContext,
    uses,
    workerUses,
    history: config.history,
    instructions,
  };

  // Default — direct generation.
  const defaultPipeline = assistantGenerator;
  const paePipeline = createPaePipeline(pipelineConfig);
  const supervisorPipeline = createSupervisorPipeline(pipelineConfig);
  const routedSpecialistsPipeline = createRoutedSpecialistsPipeline(pipelineConfig);
  const eventedActorsPipeline = createEventedActorsPipeline(pipelineConfig);
  const debatePipeline = createDebatePipeline(pipelineConfig);

  // connectInput delegates through the original block's .run, so route
  // interception (e.g. testRouter) works transparently.
  const thinkingStyleRouter = router({
    name: "thinking-style-router",
    routes: [
      defaultPipeline,
      paePipeline,
      supervisorPipeline,
      routedSpecialistsPipeline,
      eventedActorsPipeline,
      debatePipeline,
    ],
    execute: (input, ctx) => {
      const style = ctx.session.state.thinkingStyle as string | undefined;
      switch (style) {
        case "plan-and-execute":
          return paePipeline.connectInput(() => ({ goal: input.message }));
        case "supervisor":
          return supervisorPipeline.connectInput(() => ({ goal: input.message }));
        case "routed-specialists":
          return routedSpecialistsPipeline.connectInput(() => input);
        case "evented-actors":
          return eventedActorsPipeline.connectInput(() => input);
        case "moderated-debate":
          return debatePipeline.connectInput(() => ({ question: input.message }));
        default:
          return defaultPipeline;
      }
    },
  });

  return {
    thinkingStyleRouter,
    defaultPipeline,
    paePipeline,
    supervisorPipeline,
    routedSpecialistsPipeline,
    eventedActorsPipeline,
    debatePipeline,
  };
}
