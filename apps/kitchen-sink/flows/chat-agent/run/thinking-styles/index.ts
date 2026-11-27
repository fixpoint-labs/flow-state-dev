/** Route a turn to the assistant or to the background-work board. */
import { router } from "@flow-state-dev/core";
import { inputSchema, sessionStateSchema } from "../../shared/schemas";
import { assistantGenerator } from "../assistant/assistant";
import { backgroundWork } from "./pipelines/background-work";

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

export { backgroundWorkSettled, backgroundWorkTasks } from "./pipelines/background-work";
