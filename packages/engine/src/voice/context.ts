import type { BlockContext } from "@flow-state-dev/core/types";

/**
 * Context function for voice-enabled generators.
 *
 * When TTS is active or the user spoke, tells the LLM to adapt its output style
 * (shorter sentences, no markdown tables, conversational tone). Re-evaluated
 * before each step of the tool loop via prepareStep, so it reflects the current
 * request's voice metadata.
 *
 * Add to a generator's `context` array when the flow declares `voice.tts`.
 *
 * @example
 * ```ts
 * import { voiceContext } from "@flow-state-dev/engine";
 *
 * generator({
 *   name: "assistant",
 *   context: [voiceContext],
 *   // ...
 * });
 * ```
 */
export function voiceContext(_input: unknown, ctx: BlockContext): string | undefined {
  const voice = ctx.requestRuntime?.metadata?.voice as
    | { ttsEnabled?: boolean; inputModality?: string }
    | undefined;

  if (!voice) return undefined;

  const parts: string[] = [];
  if (voice.ttsEnabled) {
    parts.push(
      "Your response will be read aloud via text-to-speech. Keep sentences short and conversational. Avoid markdown formatting, tables, code blocks, and bullet lists — they sound bad when spoken."
    );
  }
  if (voice.inputModality === "speech") {
    parts.push("The user spoke this message (voice input). Respond conversationally.");
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}
