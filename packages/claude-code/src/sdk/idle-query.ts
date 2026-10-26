/**
 * Ask Claude Code one question with no model turn: `runIdleQuery()`.
 *
 * Opens one streaming-input `query()` whose input never yields, so no user
 * message is sent and no model turn starts, asks the handle one thing, and
 * closes. The account probe (`./account-probe`) and the model list
 * (`./model-list`) are both this, with a different question and their own
 * words for each outcome.
 */
import { defaultSdkImporter, type SdkImporter } from "./sdk-client";

/** What {@link runIdleQuery} got. Never a throw. */
export type IdleQueryResult<T> =
  /** The handle's answer. */
  | { status: "answer"; value: T }
  /** `@anthropic-ai/claude-agent-sdk` could not be loaded; `reason` carries the load error. */
  | { status: "sdk-missing"; reason: string }
  /** No answer within the time allowed. */
  | { status: "timeout" }
  /** The query or the question threw; `reason` is its message. */
  | { status: "error"; reason: string };

/** Options for {@link runIdleQuery}. */
export interface IdleQueryOptions {
  /** The environment Claude Code is started with. */
  env: Record<string, string>;
  /** How long to wait for the answer. */
  timeoutMs: number;
  /** Stops waiting and closes the query when it aborts, read as `timeout`. */
  signal?: AbortSignal;
  /** How the SDK module is loaded. A seam for tests; the default imports the installed SDK. */
  importSdk?: SdkImporter;
}

/**
 * Start Claude Code with no message, ask `ask` of its query handle, and close it.
 *
 * @param options The environment, how long to wait, and the SDK loader.
 * @param ask The one question, put to the open handle.
 */
export async function runIdleQuery<H extends { close?: () => void }, T>(
  options: IdleQueryOptions,
  ask: (handle: H) => Promise<T>,
): Promise<IdleQueryResult<T>> {
  let query: (args: { prompt: AsyncIterable<never>; options: { env: Record<string, string> } }) => H;
  try {
    const mod = await (options.importSdk ?? defaultSdkImporter)();
    if (typeof mod.query !== "function") throw new Error("the module has no `query` export");
    query = mod.query as typeof query;
  } catch (error) {
    return { status: "sdk-missing", reason: `@anthropic-ai/claude-agent-sdk could not be loaded: ${messageOf(error)}` };
  }

  // The input stays open until the answer is in, then ends, so no message is ever sent.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  async function* noMessages(): AsyncGenerator<never> {
    await held;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let handle: H | undefined;
  try {
    if (options.signal?.aborted) return { status: "timeout" };
    handle = query({ prompt: noMessages(), options: { env: options.env } });
    const timedOut = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), options.timeoutMs);
      onAbort = () => resolve(TIMEOUT);
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
    const value = await Promise.race([ask(handle), timedOut]);
    if (value === TIMEOUT) return { status: "timeout" };
    return { status: "answer", value: value as T };
  } catch (error) {
    return { status: "error", reason: messageOf(error) };
  } finally {
    clearTimeout(timer);
    if (onAbort !== undefined) options.signal?.removeEventListener("abort", onAbort);
    release();
    try {
      handle?.close?.();
    } catch {
      // Already closed: nothing is left running either way.
    }
  }
}

const TIMEOUT: unique symbol = Symbol("timeout");

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
