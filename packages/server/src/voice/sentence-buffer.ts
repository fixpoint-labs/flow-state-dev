/**
 * Sentence-boundary detection buffer for streaming TTS.
 * Accumulates text fragments and emits complete sentences for synthesis.
 */

const SENTENCE_BOUNDARY = /[.!?]\s+/;
const SENTENCE_END = /[.!?]$/;

export type SentenceBuffer = {
  /** Append a text delta. Returns any complete sentences ready for synthesis. */
  append(text: string): string[];
  /** Flush remaining buffered text as a final sentence. Returns empty string if nothing buffered. */
  flush(): string | undefined;
  /** Clear the buffer without emitting. */
  clear(): void;
};

/**
 * Creates a sentence-boundary buffer that splits incoming text deltas
 * into complete sentences for TTS synthesis.
 */
export function createSentenceBuffer(): SentenceBuffer {
  let buffer = "";

  return {
    append(text: string): string[] {
      buffer += text;
      const sentences: string[] = [];

      let match: RegExpExecArray | null;
      while ((match = SENTENCE_BOUNDARY.exec(buffer)) !== null) {
        const end = match.index + match[0].length;
        const sentence = buffer.slice(0, end).trim();
        if (sentence.length > 0) {
          sentences.push(sentence);
        }
        buffer = buffer.slice(end);
      }

      return sentences;
    },

    flush(): string | undefined {
      const remaining = buffer.trim();
      buffer = "";
      return remaining.length > 0 ? remaining : undefined;
    },

    clear() {
      buffer = "";
    }
  };
}
