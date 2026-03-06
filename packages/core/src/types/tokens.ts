import type { LLMMessage } from "./scope";

export interface TokenCounter {
  count(text: string, model: string): Promise<number>;
  countMessages(messages: LLMMessage[], model: string): Promise<number>;
}
