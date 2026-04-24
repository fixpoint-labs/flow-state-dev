import { z } from "zod";
import { generator, handler, sequencer } from "../blocks";

const titleSchema = z.object({
  title: z.string()
});

export interface SessionTitleGeneratorConfig {
  name: string;
  model?: string;
  /**
   * Maximum number of recent LLM messages to include for title generation.
   * @default 4
   */
  messageLimit?: number;
}

/**
 * Factory that returns a sequencer block for auto-generating a session title
 * from recent conversation messages.
 *
 * Designed for use as a `.work()` background block in a sequencer. It runs a
 * generator to produce a title from recent session messages, then a handler
 * that persists the title via `ctx.session.setMetadata({ title })` if it
 * changed. The metadata update emits a `session.metadata.changed` SSE event
 * so connected clients see the title in real-time.
 *
 * The block is a passthrough — it returns its input unchanged so it can be
 * inserted anywhere in a pipeline without affecting downstream steps.
 *
 * ```ts
 * const titleBlock = sessionTitleGenerator({
 *   name: "auto-title",
 *   model: "openai/gpt-5.4-mini"
 * });
 *
 * const pipeline = sequencer({ name: "chat", inputSchema })
 *   .then(mainGenerator)
 *   .work(titleBlock)
 * ```
 */
export function sessionTitleGenerator(config: SessionTitleGeneratorConfig) {
  const modelId = config.model ?? "openai/gpt-5-nano";
  const messageLimit = config.messageLimit ?? 4;

  const titleGenerator = generator({
    name: `${config.name}:generate`,
    inputSchema: z.unknown(),
    outputSchema: titleSchema,
    model: modelId,
    prompt: "You generate short, descriptive titles for chat sessions.",
    history: { limit: messageLimit },
    user: (_input, ctx) => {
      const currentTitle = ctx.session.metadata.title;
      return `Generate a title for this conversation based on the conversation messages.

Rules:
- Output a single concise title (3-8 words)
- Capture the main topic or intent of the conversation
- Use sentence case (capitalize first word only, unless proper nouns)
- Do not use quotes, periods, or other punctuation
- Do not prefix with "Session:" or similar labels
- Do not change the current title if it is already descriptive and appropriate

Current title: ${currentTitle ?? "(none)"}`;
    }
  });

  const persistTitle = handler({
    name: `${config.name}:persist`,
    inputSchema: titleSchema,
    outputSchema: z.unknown(),
    execute: async (input, ctx) => {
      const newTitle = input.title.trim();
      if (newTitle.length > 0 && newTitle !== ctx.session.metadata.title) {
        await ctx.session.setMetadata({ title: newTitle });
      }
      return input;
    }
  });

  return sequencer({ name: config.name, inputSchema: z.unknown() })
    .then(titleGenerator)
    .then(persistTitle);
}
