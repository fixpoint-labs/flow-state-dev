/**
 * Thinking-style router — factory + assembled instance.
 *
 * `createThinkingStyleRouter` builds the six pipelines (default + the five
 * routed styles, each in `pipelines/`) and the router that dispatches between
 * them based on `session.state.thinkingStyle`. The concrete `thinkingStyleRouter`
 * is assembled here with the chat-agent's real dependencies (the assistant
 * generator, mode prompt, memory + artifact context, features capability) so
 * `run/run.ts` imports a ready-to-step block.
 *
 * The factory pattern (config → pipelines) keeps the per-pattern wiring out of
 * `flow.ts` and lets the worker generators take a different capability/context
 * bundle from the pattern coordinators.
 */
import { router } from "@flow-state-dev/core";
import type {
  GeneratorHistoryConfig,
  GeneratorSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";

import type { InstructionsSlot, PipelineConfig } from "./pipelines/config";
import { createPaePipeline } from "./pipelines/plan-and-execute";
import { createSupervisorPipeline } from "./pipelines/supervisor";
import { createRoutedSpecialistsPipeline } from "./pipelines/routed-specialists";
import { createEventedActorsPipeline } from "./pipelines/evented-actors";
import { createDebatePipeline } from "./pipelines/debate";

import { assistantGenerator } from "../assistant/assistant";
import { resolveModePrompt } from "../assistant/mode-prompt";
import { mem } from "../cognition";
import { artifactListContext } from "../../shared/context";
import { featuresCapability } from "../../shared/capabilities/features";
import { DEFAULT_KITCHEN_SINK_MODEL } from "../../../../lib/models";

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

/**
 * Build the thinking-style router and its pipelines from `config`. The
 * `assistantGenerator` is reused as the `default` pipeline; the other five are
 * built by the per-pattern builders in `pipelines/`.
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

  // Router — adapts flow input to each pipeline's expected shape via connectInput.
  // connectInput delegates through the original block's .run, so route
  // interception (e.g. testRouter) works transparently.
  const thinkingStyleRouter = router({
    name: "thinking-style-router",
    routes: [defaultPipeline, paePipeline, supervisorPipeline, routedSpecialistsPipeline, eventedActorsPipeline, debatePipeline],
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

  return { thinkingStyleRouter, defaultPipeline, paePipeline, supervisorPipeline, routedSpecialistsPipeline, eventedActorsPipeline, debatePipeline };
}

// ---------------------------------------------------------------------------
// Assembled instance — the chat-agent's concrete router.
// ---------------------------------------------------------------------------

export const { thinkingStyleRouter } = createThinkingStyleRouter({
  assistantGenerator,
  modelId: (_input: any, ctx: any) =>
    ctx.user?.state.selectedModel ?? DEFAULT_KITCHEN_SINK_MODEL,
  history: { limit: 8 },
  context: { memory: mem.contextFormatter, artifacts: artifactListContext },
  uses: [featuresCapability],
  // Worker generators in the supervisor / routed-specialists / evented-actors
  // pipelines disable the digest + working memory section presets so the
  // parent's memory blob isn't replicated into every worker prompt. The
  // recall tool stays installed (default-on `recall` preset) so workers can
  // still look up specifics on demand. workerContext drops the `memory` key
  // for the same reason — the formerly manual installation would otherwise
  // re-inject the formatter regardless of preset.
  workerUses: [featuresCapability],
  workerContext: { artifacts: artifactListContext },
  instructions: resolveModePrompt,
});
