/**
 * Assistant generator — the chat-agent's primary generator, shared across all
 * thinking styles (it's the `default` pipeline and the body every pattern wraps).
 *
 * The system prompt is resolved per-turn from the user's selected mode via
 * `resolveModePrompt`; the model is read from user state; extended thinking is
 * an Anthropic-only provider option toggled from user state.
 */
import { generator } from "@flow-state-dev/core";
import { voiceContext } from "@flow-state-dev/engine";
import { z } from "zod";
import { inputSchema, userStateSchema, modeSchema } from "../../shared/schemas";
import { featuresCapability } from "../../shared/capabilities/features";
import { mem, analystPerspective } from "../cognition";
import { resolveModePrompt } from "./mode-prompt";
import { coalesceKitchenSinkModel } from "../../../../lib/models";

export const assistantGenerator = generator({
  name: "assistant-generator",
  userStateSchema,
  sessionStateSchema: z.object({ mode: modeSchema.default("ask"), thinkingStyle: z.string().optional() }),

  // Capabilities: auto-install resources, context formatters, and tools.
  // mem.capability defaults: `digest`, `working`, `recall` all on — renders
  // the rolling digest + working-memory entries under <memory> and installs
  // the agent-invocable recall tool. Workers further down opt out of the
  // two context presets via `.presets({ digest: false, working: false })`.
  // p.capability injects perspective framing (static + accumulated presets).
  // Perspective context appears in all modes but accumulated state only
  // grows in ask mode (capture is gated via workIf below).
  uses: [mem.capability, featuresCapability, analystPerspective.capability],

  // Object-form context: each entry becomes its own XML tag in the rendered
  // system message. Capabilities (mem, perspective) contribute their own
  // tags; same-key contributions across sources aggregate cleanly. See
  // docs/fundamentals/generator-context.md for the full contract.
  context: {
    todaysDate: new Date().toLocaleDateString(),
    voice: voiceContext
  },

  inputSchema,
  history: { limit: 8 },
  user: (input) => input.message,
  search: true,
  maxIterations: 20,
  outputSchema: z.string(),

  // Mode system prompt — one source shared with the thinking-style router's
  // `instructions` slot (see run/assistant/mode-prompt.ts).
  prompt: resolveModePrompt,

  itemVisibility: { client: true, history: true },
  // Coalesce at read time so a stale/removed catalog id (or an absent
  // `ctx.user` in test harnesses without a configured user scope) falls
  // back to the catalog default rather than reaching the model resolver.
  model: (_input: any, ctx: any) =>
    coalesceKitchenSinkModel(ctx.user?.state.selectedModel),
  // Anthropic-only — OpenAI and Google ignore this namespace, so the toggle
  // is a no-op for non-Anthropic models until per-provider reasoning
  // mappings land (FIX-517).
  providerOptions: (_input: any, ctx: any) =>
    ctx.user?.state.thinkingEnabled
      ? { anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } } }
      : {},
});
