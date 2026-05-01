/**
 * Deterministic generator mocks for unit, block, and flow tests.
 *
 * `mockGenerator` produces a scripted `MockGeneratorInstance`. Scripts mix
 * two entry kinds:
 *   - Plain steps (`MockGeneratorScriptStep`): consumed in order, one per call.
 *   - Predicate entries (`{ when, then }`): repeatable — when `when(input)`
 *     returns true the entry's `then` is returned without advancing the
 *     plain-step queue.
 *
 * Per-call resolution:
 *   1. Walk script from index 0.
 *   2. Predicate entries: evaluate `when(input)`; if true, return `then`
 *      (do not consume — predicates remain matchable on later calls).
 *   3. Plain entries before the queue head are skipped (already consumed);
 *      the entry at the queue head is returned and consumed.
 *   4. If neither a predicate matches nor a plain step is at the head,
 *      return `undefined` and the resolver throws a descriptive error.
 *
 * Tool-loop simulation (inside `createMockModelResolver`): when a returned
 * step has `toolCalls` but no terminal `text`/`structuredOutput`, the mock
 * model invokes each registered tool's `execute` closure and pulls the next
 * script step — mirroring the AI SDK's internal multi-step loop. The mock
 * stops at the first step with terminal output or when `maxSteps` is hit.
 *
 * Predicate entries let a single mock fan out across concurrent calls
 * (e.g., a supervisor pattern's worker block driven by per-task input
 * matching). Plain-only scripts behave identically to the pre-extension
 * implementation.
 */
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

/** Predicate entry: matches calls whose input satisfies `when`. */
export type MockGeneratorPredicateEntry = {
  when: (input: unknown) => boolean;
  then: MockGeneratorScriptStep;
};

/** A script entry — either a plain step (consumed sequentially) or a predicate. */
export type MockGeneratorScriptEntry =
  | MockGeneratorScriptStep
  | MockGeneratorPredicateEntry;

export type MockGeneratorInstance = {
  name: string;
  calls: Array<{
    input: unknown;
    model?: string;
    blockName?: string;
    prompt?: string;
  }>;
  /**
   * Returns the next script step for the given input. The argument is the
   * resolved input passed to predicate `when` functions; pass the model
   * messages or whatever shape the test wants predicates to inspect.
   * Returns `undefined` only when the script is empty and no predicate
   * matched — most scenarios should treat that as an error condition.
   */
  next(input?: unknown): MockGeneratorScriptStep | undefined;
  reset(): void;
};

export type UnmockedGeneratorPolicy = "error" | "warn" | "allow";

function isPredicateEntry(
  entry: MockGeneratorScriptEntry
): entry is MockGeneratorPredicateEntry {
  return typeof (entry as MockGeneratorPredicateEntry).when === "function";
}

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

/**
 * Builds a `ModelResolver` that delegates to scripted mocks. Per-block mocks
 * win over per-model mocks. Unmocked generators produce a no-op model under
 * `policy: "warn" | "allow"` and throw under `"error"` (default).
 */
export function createMockModelResolver(options: {
  generators?: Record<string, MockGeneratorInstance>;
  models?: Record<string, MockGeneratorInstance>;
  policy?: UnmockedGeneratorPolicy;
  onUnmocked?: (message: string) => void;
}): ModelResolver {
  const policy = options.policy ?? "error";

  const resolver = ((modelId: string, blockName?: string): GeneratorModel => {
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
        // Simulate the AI SDK's internal multi-step tool loop. The framework
        // calls `generate()` once per generator invocation; the model is
        // expected to return the terminal output after running any tool
        // calls itself. Walk script steps until we hit a terminal step or
        // exhaust `maxSteps`.
        //
        // `mock.calls` records framework invocations of `generate()` — one
        // entry per call, not per inner iteration. Tool-loop steps consumed
        // inside this single call don't push additional entries; tests that
        // count generator invocations stay accurate.
        mock.calls.push({
          input: generateOptions.messages,
          model: modelId,
          blockName
        });

        const maxSteps = generateOptions.maxSteps ?? 8;
        const tools = generateOptions.tools ?? [];
        const toolByName = new Map(tools.map((tool) => [tool.name, tool] as const));
        const accumulatedToolCalls: NonNullable<GeneratorModelResult["toolCalls"]> = [];

        for (let i = 0; i < maxSteps; i += 1) {
          const step = mock.next(generateOptions.messages);
          if (step === undefined) {
            const mockName = blockName ?? modelId;
            throw new Error(
              `Mock generator "${mockName}" has no script entry matching the current call. ` +
              `Plain-step queue is exhausted and no predicate matched. ` +
              `Add a plain step, a matching \`{ when, then }\` predicate, or call .reset().`
            );
          }

          const isTerminal = step.text !== undefined || step.structuredOutput !== undefined;

          // Tool-only step — invoke each registered tool's execute closure
          // (the framework attached one when it compiled the tools), record
          // the call list, and loop for the next script step.
          if (!isTerminal && step.toolCalls !== undefined && step.toolCalls.length > 0) {
            for (const call of step.toolCalls) {
              accumulatedToolCalls.push(call);
              const tool = toolByName.get(call.toolName);
              if (tool?.execute !== undefined) {
                await tool.execute(call.args, { toolCallId: call.toolCallId });
              }
            }
            continue;
          }

          // Terminal step — text, structured output, or empty.
          return {
            text: step.text,
            structuredOutput: step.structuredOutput,
            toolCalls: step.toolCalls ?? (accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined),
            finishReason: step.finishReason ?? "stop"
          };
        }

        const mockName = blockName ?? modelId;
        throw new Error(
          `Mock generator "${mockName}" exceeded maxSteps=${maxSteps} without producing a terminal step. ` +
          `Add a script entry with \`text\` or \`structuredOutput\` after the tool calls.`
        );
      }
    };
  }) as ModelResolver;

  resolver.resolveId = (modelId: string): string => modelId;

  return resolver;
}

/**
 * Creates a deterministic scripted generator mock. See module docstring for
 * the full plain-vs-predicate resolution order.
 */
export function mockGenerator(options: {
  name: string;
  script: MockGeneratorScriptEntry[];
}): MockGeneratorInstance {
  const entries = [...options.script];
  // Pointer into the plain-entry queue. Predicate entries are skipped over
  // (they don't consume) but advance this index past predicate slots so
  // the next plain step in the script is reachable.
  let plainHead = 0;
  const calls: MockGeneratorInstance["calls"] = [];

  function nextStep(input?: unknown): MockGeneratorScriptStep | undefined {
    // Walk every entry on every call. Predicate entries match repeatedly;
    // plain entries are consumed once and skipped on subsequent walks.
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];

      if (isPredicateEntry(entry)) {
        if (entry.when(input)) {
          return entry.then;
        }
        continue;
      }

      // Plain step. Consume only the first un-consumed plain entry.
      if (i < plainHead) {
        continue;
      }
      plainHead = i + 1;
      return entry;
    }

    return undefined;
  }

  return {
    name: options.name,
    calls,
    next: nextStep,
    reset(): void {
      plainHead = 0;
      calls.length = 0;
    }
  };
}
