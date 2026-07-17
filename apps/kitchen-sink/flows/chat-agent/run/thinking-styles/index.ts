/**
 * Thinking-style router — the chat-agent's assembled instance.
 *
 * Wires the reusable `createThinkingStyleRouter` factory (`create-router.ts`)
 * with this app's real dependencies — the assistant generator, mode-prompt
 * instructions, memory context, and the features capability — so `run/run.ts`
 * imports a ready-to-step block. The factory holds the construction; this file
 * holds only the kitchen-sink wiring.
 */
import { createThinkingStyleRouter } from "./create-router";
import { assistantGenerator } from "../assistant/assistant";
import { resolveModePrompt } from "../assistant/mode-prompt";
import { mem } from "../cognition";
import { featuresCapability } from "../../shared/capabilities/features";
import { coalesceKitchenSinkModel } from "../../../../lib/models";

export const { thinkingStyleRouter } = createThinkingStyleRouter({
  assistantGenerator,
  modelId: (_input: any, ctx: any) =>
    coalesceKitchenSinkModel(ctx.user?.state.selectedModel),
  history: { limit: 8 },
  // Memory is the only context threaded by hand — it isn't part of
  // featuresCapability. Artifacts inventory arrives through the capability
  // (`featuresCapability` installs `artifactsCapability`'s inventory preset),
  // so it reaches both primary and worker generators without manual threading.
  context: { memory: mem.contextFormatter },
  uses: [featuresCapability],
  // Workers drop the parent's memory blob: `workerContext: {}` omits the
  // `memory` key, and the worker memory preset keeps only the recall tool (no
  // formatter) so a sub-agent can look up specifics without replicating the
  // full memory section. Artifacts still arrive via workerUses' capability.
  workerUses: [featuresCapability],
  workerContext: {},
  instructions: resolveModePrompt,
});
