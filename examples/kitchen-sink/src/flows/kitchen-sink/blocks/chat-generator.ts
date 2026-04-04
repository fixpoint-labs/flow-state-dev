/**
 * Chat Generator — general-purpose assistant mode.
 *
 * Has access to artifacts (read + write) and search, but focuses on being
 * a helpful assistant rather than aggressively creating artifacts. Creates
 * artifacts when the user explicitly asks, not speculatively.
 *
 * Demonstrated patterns:
 *   - Factory function receives the memory system so context/capture are wired
 *     without importing a module-level singleton
 *   - userStateSchema declares only the slice the model callback needs
 *   - context array is re-evaluated per tool loop step (fresh artifact list)
 *   - emit.reasoning uses native provider reasoning tokens, not a schema field
 */
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { analysisOutputSchema } from "./analyze-input";
import { readArtifact } from "./read-artifact";
import { updateArtifact } from "./update-artifact";
import { artifactResources } from "../schemas";
import { artifactListContext, voiceContext, type GeneratorMemory } from "./agent-context";

const MODEL_ID = "openai/gpt-5.4-mini";

export function createChatGenerator(mem: GeneratorMemory) {
  return generator({
    name: "chat-generator",
    model: (_input, ctx) => (ctx.user?.state.preferredModel as string | undefined) ?? MODEL_ID,
    userStateSchema: z.object({ preferredModel: z.string().default(MODEL_ID) }),
    sessionResources: { ...artifactResources },

    context: [
      // Memory: facts, current focus, and preferences distilled from prior sessions.
      mem.contextFormatter,
      // Artifact inventory: re-evaluated each tool loop step so the LLM sees
      // artifacts created or updated earlier in the same turn.
      artifactListContext,
      // Voice: adapts output style when TTS or speech input is active.
      voiceContext,
    ] as any[],

    inputSchema: analysisOutputSchema,
    history: (_input, ctx) => ctx.session.items.llm({ limit: 8 }),
    user: (input: z.infer<typeof analysisOutputSchema>) => input.message,

    tools: [readArtifact, updateArtifact],
    search: true,
    maxIterations: 5,
    outputSchema: z.string(),

    prompt: `You are a helpful development assistant. You help users with tasks, answer questions, and search for information.

You have access to artifacts and can read or create them:
- Use read-artifact when users ask about existing artifacts or you need their content.
- Use update-artifact when users explicitly ask you to create or save something.

When users ask questions that require up-to-date information, use search.

Be concise and focused on being useful. Create artifacts when asked — not speculatively.
Never show artifact ids unless specifically asked.`,

    emit: { messages: true, reasoning: true },
    providerOptions: { openai: { reasoningSummary: "detailed" } },
  });
}
