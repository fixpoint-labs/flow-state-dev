export type OutputTextContent = {
  type: "output_text";
  text: string;
  annotations?: Array<Record<string, unknown>>;
};

export type ReasoningTextContent = {
  type: "reasoning_text";
  text: string;
};

export type RefusalContent = {
  type: "refusal";
  text: string;
};

export type FileContent = {
  type: "file";
  mediaType: string;
  data: string;
  filename?: string;
};

export type OutputAudioContent = {
  type: "output_audio";
  audio: string;
  mediaType: string;
  transcript?: string;
  duration?: number;
};

export type Content =
  | OutputTextContent
  | ReasoningTextContent
  | RefusalContent
  | FileContent
  | OutputAudioContent;
