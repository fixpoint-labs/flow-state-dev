import type {
  GeneratorModel,
  GeneratorModelResult,
  ModelResolver
} from "@flow-state-dev/core/types";

export type MockGeneratorScriptStep = {
  text?: string;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    args: unknown;
  }>;
  structuredOutput?: unknown;
  finishReason?: string;
};

export type MockGeneratorInstance = {
  name: string;
  calls: Array<{
    input: unknown;
    model?: string;
    blockName?: string;
    prompt?: string;
  }>;
  next(): MockGeneratorScriptStep | undefined;
  reset(): void;
};

export type UnmockedGeneratorPolicy = "error" | "warn" | "allow";

function createNoopModel(modelId: string): GeneratorModel {
  return {
    modelId,
    async generate(): Promise<GeneratorModelResult> {
      return {
        finishReason: "stop"
      };
    }
  };
}

export function createMockModelResolver(options: {
  generators?: Record<string, MockGeneratorInstance>;
  models?: Record<string, MockGeneratorInstance>;
  policy?: UnmockedGeneratorPolicy;
  onUnmocked?: (message: string) => void;
}): ModelResolver {
  const policy = options.policy ?? "error";

  return (modelId: string, blockName?: string): GeneratorModel => {
    const byBlock = blockName === undefined ? undefined : options.generators?.[blockName];
    const byModel = options.models?.[modelId];
    const mock = byBlock ?? byModel;

    if (mock === undefined) {
      const message = blockName === undefined
        ? `No mock for model "${modelId}". Provide models["${modelId}"] or set unmockedGeneratorPolicy to "warn" or "allow".`
        : `No mock for generator "${blockName}" / model "${modelId}". Provide generators["${blockName}"] or models["${modelId}"], or set unmockedGeneratorPolicy to "warn" or "allow".`;

      if (policy === "error") {
        throw new Error(message);
      }

      if (policy === "warn") {
        (options.onUnmocked ?? console.warn)(message);
      }

      return createNoopModel(modelId);
    }

    return {
      modelId,
      async generate(generateOptions): Promise<GeneratorModelResult> {
        mock.calls.push({
          input: generateOptions.messages,
          model: modelId,
          blockName
        });

        const step = mock.next();
        if (step === undefined) {
          const mockName = blockName ?? modelId;
          throw new Error(`Mock generator "${mockName}" exhausted its script. Call .reset() or add more script steps.`);
        }

        return {
          text: step.text,
          structuredOutput: step.structuredOutput,
          toolCalls: step.toolCalls,
          finishReason: step.finishReason ?? "stop"
        };
      }
    };
  };
}

/**
 * Creates a deterministic scripted generator mock.
 */
export function mockGenerator(options: {
  name: string;
  script: MockGeneratorScriptStep[];
}): MockGeneratorInstance {
  const steps = [...options.script];
  let index = 0;
  const calls: MockGeneratorInstance["calls"] = [];

  return {
    name: options.name,
    calls,
    next(): MockGeneratorScriptStep | undefined {
      if (index >= steps.length) {
        return undefined;
      }

      const step = steps[index];
      index += 1;
      return step;
    },
    reset(): void {
      index = 0;
      calls.length = 0;
    }
  };
}
