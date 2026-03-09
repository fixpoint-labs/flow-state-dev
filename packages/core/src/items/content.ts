/**
 * Base properties shared by all content types.
 * `ephemeral` content is streamed to the client via SSE but stripped
 * before items are persisted to the store, avoiding storage of large
 * binary payloads like audio.
 */
export type ContentBase = {
  ephemeral?: boolean;
};

export type OutputTextContent = ContentBase & {
  type: "output_text";
  text: string;
  annotations?: Array<Record<string, unknown>>;
};

export type ReasoningTextContent = ContentBase & {
  type: "reasoning_text";
  text: string;
};

export type RefusalContent = ContentBase & {
  type: "refusal";
  text: string;
};

export type FileContent = ContentBase & {
  type: "file";
  mediaType: string;
  data: string;
  filename?: string;
};

export type OutputAudioContent = ContentBase & {
  type: "output_audio";
  audio: string;
  mediaType: string;
  transcript?: string;
};

export type Content =
  | OutputTextContent
  | ReasoningTextContent
  | RefusalContent
  | FileContent
  | OutputAudioContent;

/**
 * Returns true if a content part should not be persisted to the store.
 */
export function isEphemeralContent(content: Content): boolean {
  return content.ephemeral === true;
}
