/**
 * What both labs' contract tests (`test/contract/`) run their real adapter on,
 * beside the lab's own host: a scripted model, and a plug on the in-process
 * fetch. Kept free of imports so either lab can load it from here.
 *
 * - {@link scriptedModels} is a step-capable model resolver. Each call is one
 *   model step (`generateStep` / `streamStep`), so the framework runs the
 *   tools between steps, and a script may wait between them: a main turn can
 *   file a task, wait until it has settled, and only then end.
 * - {@link pluggable} wraps a fetch: `pull()` ends every open event stream and
 *   refuses new calls, as a host that went away does; `restore()` lets calls
 *   through again.
 */

/** What a step returns: text or a structured output ends the turn; a call asks the framework to run that tool. */
export type ScriptedStep = { text: string } | { output: unknown } | { call: { name: string; args: unknown } };

/** One step of one block's turn. */
export interface ScriptedCall {
  blockName: string | undefined;
  /** The step's messages, serialized: what a script reads the request, the worker and a tool's result from. */
  said: string;
  /** How many tool results this turn holds so far: 0 on its first step. */
  step: number;
  /** Aborted when the turn is stopped. */
  signal?: AbortSignal;
}

/** A script for one block name. A script that throws fails its step, and so its turn. */
export type Script = (call: ScriptedCall) => Promise<ScriptedStep> | ScriptedStep;

interface StepOptions {
  messages: unknown[];
  signal?: AbortSignal;
  maxSteps?: number;
  tools?: { name: string; execute?: (args: unknown, options: { toolCallId: string }) => Promise<unknown> }[];
}
interface StepResult {
  text?: string;
  structuredOutput?: unknown;
  toolCalls?: { toolCallId: string; toolName: string; args: unknown }[];
  finishReason: string;
}

/**
 * A model resolver that answers each block by its script, and `fallback` for a
 * block with none. Pass it as the host's `modelResolver`; the return type is
 * left to the caller, so this file needs no package types.
 */
export function scriptedModels(scripts: Record<string, Script>, fallback: Script = () => ({ text: "ok" })): (modelId: string, blockName?: string) => unknown {
  let ids = 0;
  const stepOf = async (blockName: string | undefined, messages: unknown[], signal?: AbortSignal): Promise<StepResult> => {
    const said = JSON.stringify(messages);
    const step = messages.filter((m) => (m as { role?: string }).role === "tool").length;
    const script = (blockName === undefined ? undefined : scripts[blockName]) ?? fallback;
    const next = await script({ blockName, said, step, ...(signal === undefined ? {} : { signal }) });
    if ("text" in next) return { text: next.text, finishReason: "stop" };
    if ("output" in next) return { structuredOutput: next.output, finishReason: "stop" };
    return { toolCalls: [{ toolCallId: `call_${++ids}`, toolName: next.call.name, args: next.call.args }], finishReason: "tool-calls" };
  };
  return (modelId, blockName) => ({
    modelId,
    generateStep: (o: StepOptions) => stepOf(blockName, o.messages, o.signal),
    async *streamStep(o: StepOptions) {
      const result = await stepOf(blockName, o.messages, o.signal);
      if (result.text !== undefined) yield { type: "text_delta", textDelta: result.text };
      for (const call of result.toolCalls ?? []) {
        yield { type: "tool_call_delta", toolCallDelta: { toolCallId: call.toolCallId, toolName: call.toolName, argsDelta: JSON.stringify(call.args) } };
      }
      yield { type: "finish", finishReason: result.finishReason, fullResult: result };
    },
    // The SDK-driven loop, for a block that calls it instead: each step's tools run here.
    async generate(o: StepOptions) {
      const messages = [...o.messages];
      for (let i = 0; i < (o.maxSteps ?? 8); i += 1) {
        const result = await stepOf(blockName, messages, o.signal);
        if (result.toolCalls === undefined) return result;
        for (const call of result.toolCalls) {
          const tool = o.tools?.find((t) => t.name === call.toolName);
          const output = tool?.execute === undefined ? { ok: true } : await tool.execute(call.args, { toolCallId: call.toolCallId });
          messages.push({ role: "tool", content: [{ type: "tool-result", toolCallId: call.toolCallId, toolName: call.toolName, output }] });
        }
      }
      throw new Error(`scripted model: ${blockName ?? modelId} never ended its turn`);
    },
  });
}

/** Resolves after `ms`, or when `signal` aborts. */
export const waitFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** `inner`, with a plug: pulled, every open event stream errors and every call fails as a lost network does. */
export function pluggable(inner: Fetch): { fetcher: Fetch; pull(): void; restore(): void } {
  let down = false;
  const open = new Set<() => void>();
  const fetcher: Fetch = async (input, init) => {
    if (down) throw new TypeError("fetch failed");
    const response = await inner(input, init);
    if (response.body === null || !(response.headers.get("content-type") ?? "").includes("event-stream")) return response;
    const reader = response.body.getReader();
    let cut = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        cut = () => {
          try {
            controller.error(new TypeError("network connection lost"));
          } catch {
            // already closed
          }
          void reader.cancel().catch(() => {});
        };
        open.add(cut);
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            open.delete(cut);
            controller.close();
          } else controller.enqueue(value);
        } catch {
          open.delete(cut);
        }
      },
      cancel() {
        open.delete(cut);
        return reader.cancel();
      },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  };
  return {
    fetcher,
    pull() {
      down = true;
      for (const cut of [...open]) cut();
      open.clear();
    },
    restore() {
      down = false;
    },
  };
}
