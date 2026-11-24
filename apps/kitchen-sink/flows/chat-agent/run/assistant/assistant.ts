/**
 * Assistant generator — the chat-agent's primary generator, shared across all
 * thinking styles (it's the `default` pipeline and the body every pattern wraps).
 *
 * The session mode selects the prompt. User preferences select the model
 * and toggle extended thinking for Anthropic models.
 */
import { generator } from "@flow-state-dev/core";
import { voiceContext } from "@flow-state-dev/engine";
import { z } from "zod";
import { inputSchema, userStateSchema, sessionStateSchema } from "../../shared/schemas";
import { featuresCapability } from "../../shared/capabilities/features";
import { mem, analystPerspective } from "../cognition";
import { loadPrompt } from "../../shared/prompts";
import { coalesceKitchenSinkModel } from "../../../../lib/models";

const modePrompts = {
  ask: loadPrompt("run/assistant/prompts/ask.prompt.md"),
  build: loadPrompt("run/assistant/prompts/build.prompt.md"),
  interview: loadPrompt("run/assistant/prompts/interview.prompt.md"),
  debate: loadPrompt("run/assistant/prompts/debate.prompt.md"),
} as const;

export const assistantGenerator = generator({
  name: "assistant-generator",
  userStateSchema,
  sessionStateSchema: sessionStateSchema.pick({ mode: true }),

  // Capabilities: auto-install resources, context formatters, and tools.
  // mem.capability defaults: `digest`, `working`, `recall` all on — renders
  // the rolling digest + working-memory entries under <memory> and installs
  // the agent-invocable recall tool. Workers further down opt out of the
  // two context presets via `.presets({ digest: false, working: false })`.
  // p.capability injects perspective framing (static + accumulated presets).
  // Perspective context appears in all modes but accumulated state only
  // grows in ask mode (capture is gated via sideChainIf below).
  uses: [mem.capability, featuresCapability, analystPerspective.capability],

  // Object-form context: each entry becomes its own XML tag in the rendered
  // system message. Capabilities (mem, perspective) contribute their own
  // tags; same-key contributions across sources aggregate cleanly. See
  // docs/fundamentals/generator-context.md for the full contract.
  context: {
    // A function, so it is read on every turn — a value here would be fixed
    // at module load and go stale on a long-running server.
    todaysDate: () => new Date().toLocaleDateString(),
    voice: (input, ctx) => voiceContext(input, ctx)
  },

  inputSchema,
  history: { limit: 8 },
  user: (input) => input.message,
  search: true,
  maxIterations: 20,
  outputSchema: z.string(),

  // A retired mode in stored state still gets the ask prompt.
  prompt: (input, ctx) => (modePrompts[ctx.session.state.mode] ?? modePrompts.ask).prompt(input, ctx),

  itemVisibility: { client: true, history: true },
  // Coalesce at read time so a stale/removed catalog id (or an absent
  // `ctx.user` in test harnesses without a configured user scope) falls
  // back to the catalog default rather than reaching the model resolver.
  model: (_input, ctx) =>
    coalesceKitchenSinkModel(ctx.user?.state.selectedModel),
  // Anthropic-only — OpenAI and Google ignore this namespace, so the toggle
  // is a no-op for non-Anthropic models until per-provider reasoning
  // mappings land (FIX-517).
  providerOptions: (_input, ctx) =>
    ctx.user?.state.thinkingEnabled
      ? { anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } } }
      : {},
});
