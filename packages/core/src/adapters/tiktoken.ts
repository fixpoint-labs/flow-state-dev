import type { LLMMessage } from "../types/scope";
import type { TokenCounter } from "../types/tokens";

type Tiktoken = {
  encode(value: string): number[];
};

type TiktokenModel = string;

interface TiktokenModule {
  get_encoding(encoding: string): Tiktoken;
  encoding_for_model(model: TiktokenModel): Tiktoken;
}

function stringifyMessageContent(message: LLMMessage): string {
  return JSON.stringify(message.content);
}

export function createTiktokenCounter(tiktoken: TiktokenModule): TokenCounter {
  const cache = new Map<string, Tiktoken>();

  const getEncoder = (model: string): Tiktoken => {
    const cached = cache.get(model);
    if (cached !== undefined) {
      return cached;
    }

    let encoder: Tiktoken;
    try {
      encoder = tiktoken.encoding_for_model(model as TiktokenModel);
    } catch {
      encoder = tiktoken.get_encoding("cl100k_base");
    }

    cache.set(model, encoder);
    return encoder;
  };

  return {
    async count(text: string, model: string): Promise<number> {
      return getEncoder(model).encode(text).length;
    },
    async countMessages(messages: LLMMessage[], model: string): Promise<number> {
      const encoder = getEncoder(model);
      return messages.reduce((acc, message) => {
        return acc + encoder.encode(stringifyMessageContent(message)).length;
      }, 0);
    }
  };
}
