/**
 * `tools/call` result formatting from `ExecutionResult`.
 *
 * v1 returns single-text-content tool results. The strategy is:
 *   1. If the action set an explicit terminal `output`, stringify it.
 *   2. Otherwise, walk back through the items log and pick up the most
 *      recent terminal text item — typically the model's last message
 *      or a block's stringified output.
 *   3. If nothing renders, return an empty string (not "undefined").
 *
 * Errors map to a tool result with `isError: true` and the error
 * message as text content. The runtime distinction between "the call
 * failed" and "the action returned an error result" is preserved by
 * `isError`.
 */
import type { ExecutionResult } from "@flow-state-dev/server";

export interface McpToolContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpToolContent[];
  isError?: boolean;
}

/** Build an MCP tool result from a runtime `ExecutionResult`. */
export function toolResultFromExecution(result: ExecutionResult): McpToolResult {
  if (result.error !== undefined) {
    return {
      content: [{ type: "text", text: formatErrorForLlm(result.error) }],
      isError: true
    };
  }
  return {
    content: [{ type: "text", text: stringifyForLlm(result.output, result.items) }]
  };
}

function formatErrorForLlm(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function stringifyForLlm(output: unknown, items: ExecutionResult["items"]): string {
  if (output !== undefined) {
    return typeof output === "string" ? output : safeJsonStringify(output);
  }
  return extractTerminalMessage(items);
}

function extractTerminalMessage(items: ExecutionResult["items"]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as Record<string, unknown> | undefined;
    if (item === undefined) continue;
    const itemType = item.type;
    if (itemType === "message" && typeof item.text === "string") return item.text;
    if (itemType === "block_trace" && item.output !== undefined) {
      return typeof item.output === "string"
        ? item.output
        : safeJsonStringify(item.output);
    }
  }
  return "";
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
