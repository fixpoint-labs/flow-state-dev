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
    prompt?: string;
  }>;
  next(): MockGeneratorScriptStep | undefined;
  reset(): void;
};

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
