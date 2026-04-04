/**
 * Create Generator — artifact-creation mode.
 *
 * Same wiring as chat-generator (model, context, resources, tools, search,
 * history, emit) but with a prompt focused on building artifacts proactively.
 * When the user asks for anything expressible as a document, create it
 * immediately rather than explaining it.
 *
 * Demonstrated patterns:
 *   - Factory receives the same GeneratorMemory shape as createChatGenerator,
 *     so the same `mem` object from flow.ts works for both
 *   - Prompt is the only meaningful difference between chat and create modes —
 *     identical infrastructure, different behavioral contract
 */
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { analysisOutputSchema } from "./analyze-input";
import { readArtifact } from "./read-artifact";
import { updateArtifact } from "./update-artifact";
import { artifactResources } from "../schemas";
import { artifactListContext, voiceContext, type GeneratorMemory } from "./agent-context";

const MODEL_ID = "openai/gpt-5.4-mini";

export function createCreateGenerator(mem: GeneratorMemory) {
  return generator({
    name: "create-generator",
    model: (_input, ctx) => (ctx.user?.state.preferredModel as string | undefined) ?? MODEL_ID,
    userStateSchema: z.object({ preferredModel: z.string().default(MODEL_ID) }),
    sessionResources: { ...artifactResources },

    context: [
      mem.contextFormatter,
      artifactListContext,
      voiceContext,
    ] as any[],

    inputSchema: analysisOutputSchema,
    history: (_input, ctx) => ctx.session.items.llm({ limit: 8 }),
    user: (input: z.infer<typeof analysisOutputSchema>) => input.message,

    tools: [readArtifact, updateArtifact],
    search: true,
    maxIterations: 5,
    outputSchema: z.string(),

    prompt: `You are a creative development assistant. Your primary role is building artifacts.

When the user asks for anything that could be expressed as an artifact — code, documentation, a spec, a plan, a report, a list — create it immediately using update-artifact. Choose a descriptive id (kebab-case) and a clear title.

Prefer building over explaining. If you can produce a concrete artifact, do so rather than describing what you would build.

When users ask questions, answer them — but look for opportunities to produce something tangible. If an existing artifact is relevant, read it first with read-artifact before updating or building on it.

Never show artifact ids unless specifically asked.`,

    emit: { messages: true, reasoning: true },
    providerOptions: { openai: { reasoningSummary: "detailed" } },
  });
}
