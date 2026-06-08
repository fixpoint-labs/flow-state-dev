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
  GeneratorModelStreamChunk,
  GeneratorModelTool,
  ModelResolver
} from "@flow-state-dev/core/types";

type MockToolCall = { toolCallId: string; toolName: string; args: unknown };

type ScriptOutcome =
  | { kind: "tool_call"; toolCall: MockToolCall }
  | { kind: "tool_result"; toolCallId: string; toolName: string; result: unknown }
  | {
      kind: "terminal";
      text?: string;
      structuredOutput?: unknown;
      toolCalls?: MockToolCall[];
      finishReason: string;
    };

/**
 * Walk a mock script as an async generator of outcomes. Both `generate()` and
 * `stream()` consume this so they stay in lockstep — the only difference
 * between the two surfaces is how outcomes are assembled into a result
 * vs. yielded as chunks.
 *
 * Loop invariants:
 *   - Predicate entries match per-call against the current messages.
 *   - A non-terminal step with `toolCalls` yields one `tool_call` outcome per
 *     call; the loop awaits `tool.execute(args, { toolCallId })` (synthesises
 *     `{ ok: true }` when no execute closure is registered) and yields a
 *     `tool_result` outcome before pulling the next script step. Tool errors
 *     propagate.
 *   - The first step with `text` or `structuredOutput` is terminal: yields a
 *     `terminal` outcome carrying the accumulated tool calls (when the
 *     terminal step itself has none) and returns.
 *   - Exhausting `maxSteps` without a terminal step throws the same message
 *     `generate()` did before this helper existed.
 */
async function* runScript(
  mock: MockGeneratorInstance,
  modelId: string,
  blockName: string | undefined,
  options: {
    messages: unknown;
    maxSteps?: number;
    tools?: GeneratorModelTool[];
  }
): AsyncGenerator<ScriptOutcome> {
  const maxSteps = options.maxSteps ?? 8;
  const tools = options.tools ?? [];
  const toolByName = new Map(tools.map((tool) => [tool.name, tool] as const));
  const accumulatedToolCalls: MockToolCall[] = [];

  for (let i = 0; i < maxSteps; i += 1) {
    const step = mock.next(options.messages);
    if (step === undefined) {
      const mockName = blockName ?? modelId;
      throw new Error(
        `Mock generator "${mockName}" has no script entry matching the current call. ` +
        `Plain-step queue is exhausted and no predicate matched. ` +
        `Add a plain step, a matching \`{ when, then }\` predicate, or call .reset().`
      );
    }

    const isTerminal = step.text !== undefined || step.structuredOutput !== undefined;

    if (!isTerminal && step.toolCalls !== undefined && step.toolCalls.length > 0) {
      for (const call of step.toolCalls) {
        accumulatedToolCalls.push(call);
        yield { kind: "tool_call", toolCall: call };
        const tool = toolByName.get(call.toolName);
        const result = tool?.execute === undefined
          ? { ok: true }
          : await tool.execute(call.args, { toolCallId: call.toolCallId });
        yield { kind: "tool_result", toolCallId: call.toolCallId, toolName: call.toolName, result };
      }
      continue;
    }

    yield {
      kind: "terminal",
      text: step.text,
      structuredOutput: step.structuredOutput,
      toolCalls: step.toolCalls ?? (accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined),
      finishReason: step.finishReason ?? "stop"
    };
    return;
  }

  const mockName = blockName ?? modelId;
  throw new Error(
    `Mock generator "${mockName}" exceeded maxSteps=${maxSteps} without producing a terminal step. ` +
    `Add a script entry with \`text\` or \`structuredOutput\` after the tool calls.`
  );
}

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

export type UnmockedGeneratorPolicy = "error" | "warn" | "allow" | "default";

/**
 * Fallback for an unmocked generator under `policy: "default"`. Either a static
 * script step or a per-resolve factory keyed on the model / block being
 * resolved. Omitting it under `"default"` yields a no-op terminal step.
 */
export type UnmockedDefault =
  | MockGeneratorScriptStep
  | ((info: { modelId: string; blockName?: string }) => MockGeneratorScriptStep);

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
    },
    async *stream(): AsyncIterable<GeneratorModelStreamChunk> {
      yield { type: "finish", fullResult: { finishReason: "stop" } };
    }
  };
}

/** Resolve the fallback script step for an unmocked generator under
 * `policy: "default"`. Omitted fallback ⇒ a no-op terminal step. */
function resolveUnmockedDefault(
  unmockedDefault: UnmockedDefault | undefined,
  modelId: string,
  blockName?: string
): MockGeneratorScriptStep {
  if (unmockedDefault === undefined) {
    return { finishReason: "stop" };
  }
  return typeof unmockedDefault === "function"
    ? unmockedDefault({ modelId, blockName })
    : unmockedDefault;
}

/**
 * Builds a `ModelResolver` that delegates to scripted mocks. Per-block mocks
 * win over per-model mocks. Unmocked generators throw under `policy: "error"`
 * (default), produce a no-op model under `"warn" | "allow"`, and yield the
 * caller-supplied `unmockedDefault` script under `"default"` — so a large
 * e2e flow can fall back for the generators it didn't mock instead of breaking.
 */
export function createMockModelResolver(options: {
  generators?: Record<string, MockGeneratorInstance>;
  models?: Record<string, MockGeneratorInstance>;
  policy?: UnmockedGeneratorPolicy;
  onUnmocked?: (message: string) => void;
  unmockedDefault?: UnmockedDefault;
}): ModelResolver {
  const policy = options.policy ?? "error";

  const resolver = ((modelId: string, blockName?: string): GeneratorModel => {
    const byBlock = blockName === undefined ? undefined : options.generators?.[blockName];
    const byModel = options.models?.[modelId];
    const matched = byBlock ?? byModel;

    // One model factory serves both a matched mock and the "default" fallback,
    // so the fallback honors structuredOutput / text / tool loops identically.
    const buildModel = (mock: MockGeneratorInstance): GeneratorModel => ({
      modelId,
      async generate(generateOptions): Promise<GeneratorModelResult> {
        // Simulate the AI SDK's internal multi-step tool loop via `runScript`.
        // `mock.calls` records external invocations — one entry per call
        // regardless of how many inner script steps are consumed, and shared
        // with `stream()` so tests counting generator invocations stay accurate.
        mock.calls.push({
          input: generateOptions.messages,
          model: modelId,
          blockName
        });

        // `steps` is intentionally not synthesised: the mock can't know how
        // a real provider would partition tool rounds into AI SDK steps,
        // and collapsing every round into one synthetic entry would mislead
        // any direct caller asserting on `result.steps.length`. Leaving
        // `steps` undefined matches pre-FIX-661 mock behavior. Tests that
        // need to assert on the non-streaming branch's per-step pairing
        // should use an inline model literal (see generator.test.ts).
        for await (const outcome of runScript(mock, modelId, blockName, generateOptions)) {
          if (outcome.kind === "terminal") {
            return {
              text: outcome.text,
              structuredOutput: outcome.structuredOutput,
              toolCalls: outcome.toolCalls,
              finishReason: outcome.finishReason
            };
          }
        }

        // Unreachable: runScript either yields a terminal outcome or throws.
        return { finishReason: "stop" };
      },
      async *stream(streamOptions): AsyncIterable<GeneratorModelStreamChunk> {
        mock.calls.push({
          input: streamOptions.messages,
          model: modelId,
          blockName
        });

        const streamedCallIds = new Set<string>();
        let terminal: ScriptOutcome | undefined;

        for await (const outcome of runScript(mock, modelId, blockName, streamOptions)) {
          if (outcome.kind === "tool_call") {
            streamedCallIds.add(outcome.toolCall.toolCallId);
            yield {
              type: "tool_call_delta",
              toolCallDelta: {
                toolCallId: outcome.toolCall.toolCallId,
                toolName: outcome.toolCall.toolName,
                argsDelta: JSON.stringify(outcome.toolCall.args ?? {})
              }
            };
          } else if (outcome.kind === "tool_result") {
            yield {
              type: "tool_result",
              toolResult: {
                toolCallId: outcome.toolCallId,
                toolName: outcome.toolName,
                result: outcome.result
              }
            };
          } else {
            terminal = outcome;
            // Terminal-step-with-toolCalls idiom: a script step that has BOTH
            // `text`/`structuredOutput` AND `toolCalls` declares the calls
            // observable without driving the mock's tool-execute loop (see
            // module docstring + `runScript` terminal handling). For
            // observability parity with the streaming branch in production —
            // and so kitchen-sink-style tool-group UIs can render their
            // placeholder rows — we still emit `tool_call_delta` chunks for
            // each call here. The framework-compiled tool's `execute` is
            // invoked best-effort so its `emitToolOutputAround` wrapper
            // fires the `tool_output` placeholder; errors are swallowed
            // because the script author opted out of tool execution by
            // packaging the calls onto a terminal step.
            const terminalToolCalls = outcome.toolCalls ?? [];
            const unstreamed = terminalToolCalls.filter((c) => !streamedCallIds.has(c.toolCallId));
            if (unstreamed.length > 0) {
              const toolByName = new Map(
                (streamOptions.tools ?? []).map((t) => [t.name, t] as const)
              );
              for (const call of unstreamed) {
                yield {
                  type: "tool_call_delta",
                  toolCallDelta: {
                    toolCallId: call.toolCallId,
                    toolName: call.toolName,
                    argsDelta: JSON.stringify(call.args ?? {})
                  }
                };
                const tool = toolByName.get(call.toolName);
                if (tool?.execute !== undefined) {
                  try {
                    await tool.execute(call.args, { toolCallId: call.toolCallId });
                  } catch {
                    /* terminal-step idiom: tool errors are intentionally
                       swallowed so the placeholder `tool_output` item fires
                       without the script having to register a non-throwing
                       execute closure for each tool. */
                  }
                }
              }
            }
            if (outcome.text !== undefined && outcome.text.length > 0) {
              yield { type: "text_delta", textDelta: outcome.text };
            }
            break;
          }
        }

        const finishReason = terminal?.kind === "terminal" ? terminal.finishReason : "stop";
        const fullResult: GeneratorModelResult = {
          text: terminal?.kind === "terminal" ? terminal.text : undefined,
          structuredOutput: terminal?.kind === "terminal" ? terminal.structuredOutput : undefined,
          toolCalls: terminal?.kind === "terminal" ? terminal.toolCalls : undefined,
          finishReason
        };
        yield { type: "finish", finishReason, fullResult };
      }
    });

    if (matched !== undefined) {
      return buildModel(matched);
    }

    const message = blockName === undefined
      ? `No mock for model "${modelId}". Provide models["${modelId}"] or set unmockedGeneratorPolicy to "warn", "allow", or "default".`
      : `No mock for generator "${blockName}" / model "${modelId}". Provide generators["${blockName}"] or models["${modelId}"], or set unmockedGeneratorPolicy to "warn", "allow", or "default".`;

    if (policy === "error") {
      throw new Error(message);
    }

    if (policy === "warn") {
      (options.onUnmocked ?? console.warn)(message);
    }

    if (policy === "default") {
      // A repeatable predicate entry so the fallback survives multiple calls on
      // the same resolved model.
      const step = resolveUnmockedDefault(options.unmockedDefault, modelId, blockName);
      return buildModel(
        mockGenerator({
          name: blockName ?? modelId,
          script: [{ when: () => true, then: step }]
        })
      );
    }

    return createNoopModel(modelId);
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
