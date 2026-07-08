/**
 * Visibility-agnostic LLM message builders for tool-loop conversations.
 *
 * Single home for the message shapes that represent a model step's tool
 * calls and their results, shared by:
 *   - the framework-owned generator step loop (live inter-step messages),
 *   - the engine's history replay (`itemToLLMMessages` wraps these builders
 *     with its history-visibility gate),
 *   - and, in a later change, resume reconstruction from the persistent
 *     item log.
 *
 * The shapes follow the AI SDK `ModelMessage` content-part convention:
 * one assistant message carries ALL of a step's `tool-call` parts (plus the
 * step's text, when any), and each settled call gets a `tool` role message
 * with a single `tool-result` part. Tool names here are the model-facing
 * aliases (see `computeToolAliases`), not framework block names.
 */
import type { LLMMessage } from "../types/scope";

/** One requested tool call, keyed by the model-facing alias. */
export type LLMToolCallPart = {
  toolCallId: string;
  /** Model-facing tool alias (what the model's tool dictionary uses). */
  toolName: string;
  /** Parsed call arguments. */
  input: unknown;
};

/**
 * Model-facing payload of a tool result, mirroring the AI SDK's
 * `ToolResultOutput` variants this framework produces:
 * - `text` — plain string output (and history replay's stringified form)
 * - `json` — structured output, verbatim
 * - `error-text` — a failed call surfaced to the model as an error message
 * - `content` — a `mapModelOutput`-mapped string in the SDK v7 content
 *   envelope (matches the adapter's `toModelOutput` bridge)
 */
export type LLMToolResultOutput =
  | { type: "text"; value: string }
  | { type: "json"; value: unknown }
  | { type: "error-text"; value: string }
  | { type: "content"; value: Array<{ type: "text"; text: string }> };

/**
 * Builds ONE assistant message for a model step from its full tool-call
 * array plus the step's optional text. A step with multiple parallel tool
 * calls produced a single assistant turn containing all of them — splitting
 * it into per-call messages changes the conversation shape provider APIs
 * validate against. Empty text is omitted (matching the AI SDK, which
 * skips empty text parts).
 */
export function buildAssistantToolCallMessage(
  calls: LLMToolCallPart[],
  text?: string
): LLMMessage {
  const content: unknown[] = [];
  if (text !== undefined && text.length > 0) {
    content.push({ type: "text", text });
  }
  for (const call of calls) {
    content.push({
      type: "tool-call",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    });
  }
  return { role: "assistant", content };
}

/**
 * Builds the `tool` role message carrying one settled call's result. One
 * message per call, appended in call order after the step's assistant
 * message.
 */
export function buildToolResultMessage(
  call: { toolCallId: string; toolName: string },
  output: LLMToolResultOutput
): LLMMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output,
      },
    ],
  };
}

/**
 * The failed-tool result text shape used by history replay for a
 * `tool_output` with `status: "failed"`. Kept here so live and replay
 * paths can't drift apart.
 */
export function failedToolResultText(toolName: string, errorMessage: string): string {
  return `Tool "${toolName}" failed: ${errorMessage}`;
}

/**
 * Computes the model-facing result payload for a successfully settled tool
 * call, applying the same rules the AI SDK applies when it owns the loop:
 * - a `mapModelOutput`-mapped string (when the tool declares a mapper) is
 *   wrapped in the v7 content envelope, exactly like the adapter's
 *   `toModelOutput` bridge;
 * - otherwise a string output becomes a `text` payload and anything else a
 *   `json` payload (`undefined` normalized to `null`, matching the SDK).
 */
export function toolResultOutputForModel(
  output: unknown,
  mappedText?: string
): LLMToolResultOutput {
  if (mappedText !== undefined) {
    return { type: "content", value: [{ type: "text", text: mappedText }] };
  }
  if (typeof output === "string") {
    return { type: "text", value: output };
  }
  return { type: "json", value: output === undefined ? null : output };
}
