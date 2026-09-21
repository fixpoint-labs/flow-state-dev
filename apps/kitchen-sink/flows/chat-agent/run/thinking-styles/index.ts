/**
 * Thinking-style router — the chat-agent's assembled instance.
 *
 * Wires the reusable `createThinkingStyleRouter` factory (`create-router.ts`)
 * with this app's real dependencies — the assistant generator and the model
 * resolver — so `run/run.ts` imports a ready-to-step block. The factory holds
 * the construction; this file holds only the kitchen-sink wiring.
 *
 * The context, capability, history and instruction slots this used to pass
 * went with the coordination-pattern pipelines that read them (FIX-1478).
 * `assistantGenerator` arrives already built with its own capabilities,
 * context and mode prompt, and the background-work worker runs in a child
 * session and declares itself bare.
 */
import { createThinkingStyleRouter } from "./create-router";
import { assistantGenerator } from "../assistant/assistant";
import { coalesceKitchenSinkModel } from "../../../../lib/models";

export const { thinkingStyleRouter, backgroundWorkTasks } = createThinkingStyleRouter({
  assistantGenerator,
  modelId: (_input: any, ctx: any) =>
    coalesceKitchenSinkModel(ctx.user?.state.selectedModel),
});
