/**
 * Thinking-style router — default answers in the turn; background-work files
 * the message to a durable board and returns.
 */
import { router } from "@flow-state-dev/core";
import { assistantGenerator } from "../assistant/assistant";
import { coalesceKitchenSinkModel } from "../../../../lib/models";
import { createBackgroundWorkPipeline } from "./pipelines/background-work";

const backgroundWorkPipeline = createBackgroundWorkPipeline(
  (_input: any, ctx: any) => coalesceKitchenSinkModel(ctx.user?.state.selectedModel),
);

// connectInput delegates through the original block's .run, so route
// interception (e.g. testRouter) works transparently.
export const thinkingStyleRouter = router({
  name: "thinking-style-router",
  routes: [assistantGenerator, backgroundWorkPipeline],
  execute: (input, ctx) => {
    const style = ctx.session.state.thinkingStyle as string | undefined;
    return style === "background-work"
      ? backgroundWorkPipeline.connectInput(() => ({ message: input.message }))
      : assistantGenerator;
  },
});

/**
 * The background-work board's task entries, for the flow to declare under
 * `task: { actions }`. The board hands each row off to a child session, and
 * the entry is the claim gate that child's `task` dispatch resolves.
 */
export const backgroundWorkTasks = backgroundWorkPipeline.taskEntries;
