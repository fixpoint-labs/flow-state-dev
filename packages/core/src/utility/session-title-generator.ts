import { z } from "zod";
import { handler } from "../blocks";

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
 * Factory that returns a handler block for auto-generating a session title
 * from recent conversation messages.
 *
 * Designed for use as a `.work()` background block in a sequencer. It reads
 * recent session messages, asks the LLM for a concise title, and persists it
 * via `ctx.session.setMetadata({ title })`. The metadata update emits a
 * `session.metadata.changed` SSE event so connected clients see the title
 * in real-time.
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
  const modelId = config.model ?? "gpt-5-mini";
  const messageLimit = config.messageLimit ?? 4;

  return handler({
    name: config.name,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    transient: true,
    execute: async (input, ctx) => {
      const messages = await ctx.session.items.llm({ limit: messageLimit });
      if (messages.length === 0) {
        return input;
      }

      const model = ctx.resolveModel(modelId, config.name);
      const result = await model.generate({
        messages: [
          {
            role: "system",
            content: `You generate short, descriptive titles for chat sessions. Rules:
- Output a single concise title (3-8 words)
- Capture the main topic or intent of the conversation
- Use sentence case (capitalize first word only, unless proper nouns)
- Do not use quotes, periods, or other punctuation
- Do not prefix with "Session:" or similar labels`
          },
          ...messages,
          {
            role: "user",
            content: "Generate a title for this conversation based on the messages above."
          }
        ],
        outputSchema: titleSchema,
        signal: ctx.signal
      });

      const parsed = titleSchema.safeParse(result.structuredOutput);
      if (parsed.success && parsed.data.title.trim().length > 0) {
        await ctx.session.setMetadata({ title: parsed.data.title.trim() });
      }

      return input;
    }
  });
}
