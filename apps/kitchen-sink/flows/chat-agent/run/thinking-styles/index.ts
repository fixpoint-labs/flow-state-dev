/** Route a turn to the assistant or to the background-work board. */
import { router } from "@flow-state-dev/core";
import { inputSchema, sessionStateSchema } from "../../shared/schemas";
import { assistantGenerator } from "../assistant/assistant";
import { createBackgroundWorkPipeline } from "./pipelines/background-work";

const backgroundWork = createBackgroundWorkPipeline();

/** The dispatched worker registered under the flow's task actions. */
export const backgroundWorkTasks = backgroundWork.taskEntries;

export const thinkingStyleRouter = router({
  name: "thinking-style-router",
  inputSchema,
  sessionStateSchema: sessionStateSchema.pick({ thinkingStyle: true }),
  routes: [assistantGenerator, backgroundWork],
  execute: (input, ctx) =>
    ctx.session.state.thinkingStyle === "background-work"
      ? backgroundWork.connectInput(() => ({ message: input.message }))
      : assistantGenerator,
});

export { backgroundWorkSettled } from "./pipelines/background-work";
