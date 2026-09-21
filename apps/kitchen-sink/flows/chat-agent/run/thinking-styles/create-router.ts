/**
 * Thinking-style router factory — the reusable construction (config → router).
 *
 * `createThinkingStyleRouter` builds the two pipelines (default + background
 * work) and the router that dispatches between them based on
 * `session.state.thinkingStyle`. It's dependency-free of the chat-agent's
 * concrete wiring — the assembled instance lives in `index.ts`.
 *
 * It used to build five more, each wrapping a coordination pattern from
 * `@flow-state-dev/patterns` around sub-agent generators that ran and ended
 * inside the turn. Those were removed (FIX-1478): the app's one recipe for
 * work done by several agents is the roster of hired seats, and a second
 * in-request one on the same screen taught the reader that `worker` means two
 * different things. The patterns themselves are unaffected and still shipped —
 * see the patterns documentation, which carries a runnable example per page.
 */
import { router } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";

import type { PipelineConfig } from "./pipelines/config";
import { createBackgroundWorkPipeline } from "./pipelines/background-work";

export interface ThinkingStyleRouterConfig {
  assistantGenerator: BlockDefinition<any, any>;
  /** Model ID string or a selectModel() resolver. */
  modelId: string | ((input: any, ctx: any) => any);
}

/**
 * Build the thinking-style router and its pipelines from `config`. The
 * `assistantGenerator` is reused as the `default` pipeline; `background-work`
 * is built by its own module in `pipelines/`.
 */
export function createThinkingStyleRouter(config: ThinkingStyleRouterConfig) {
  const { assistantGenerator, modelId } = config;

  const pipelineConfig: PipelineConfig = { modelId };

  // Default — direct generation.
  const defaultPipeline = assistantGenerator;
  const backgroundWorkPipeline = createBackgroundWorkPipeline(pipelineConfig);

  // connectInput delegates through the original block's .run, so route
  // interception (e.g. testRouter) works transparently.
  const thinkingStyleRouter = router({
    name: "thinking-style-router",
    routes: [defaultPipeline, backgroundWorkPipeline],
    execute: (input, ctx) => {
      const style = ctx.session.state.thinkingStyle as string | undefined;
      switch (style) {
        case "background-work":
          return backgroundWorkPipeline.connectInput(() => ({ message: input.message }));
        default:
          return defaultPipeline;
      }
    },
  });

  return {
    thinkingStyleRouter,
    defaultPipeline,
    backgroundWorkPipeline,
    /**
     * The background-work board's task entries, for the flow to declare under
     * `task: { actions }`. The board hands each row off to a child session, and
     * the entry is the claim gate that child's `task` dispatch resolves.
     */
    backgroundWorkTasks: backgroundWorkPipeline.taskEntries,
  };
}
