/**
 * Item-stream helpers for flow integration tests.
 *
 * Plain functions, not custom vitest matchers. Filtering by type and
 * extracting text from `MessageItem.content` parts is shared boilerplate
 * across scenarios; everything else stays in the test file so the
 * assertions speak for themselves.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { TestFlowResult } from "@flow-state-dev/testing";

/** Returns every item of the given top-level `type`. */
export function itemsByType<T extends OutputItem["type"]>(
  items: OutputItem[],
  type: T
): Extract<OutputItem, { type: T }>[] {
  return items.filter((item): item is Extract<OutputItem, { type: T }> => item.type === type);
}

/** Returns the first message item with the given role, or `undefined`. */
export function findMessage(
  items: OutputItem[],
  role: "user" | "assistant" | "system" | "developer" | "tool"
): Extract<OutputItem, { type: "message" }> | undefined {
  return itemsByType(items, "message").find((item) => item.role === role);
}

/** Concatenates all `output_text` parts of a message item. */
export function messageText(item: Extract<OutputItem, { type: "message" }>): string {
  return item.content
    .filter((part): part is { type: "output_text"; text: string } => part.type === "output_text")
    .map((part) => part.text)
    .join("");
}

/**
 * Returns every `block_tool_output` item — the runtime's record of a tool
 * the generator invoked. Generator-emitted tool calls land here once the
 * tool block has executed.
 */
export function findToolCalls(items: OutputItem[]): Extract<OutputItem, { type: "block_tool_output" }>[] {
  return itemsByType(items, "block_tool_output");
}

/**
 * Returns `resource_change` items whose path matches the given prefix.
 * For artifact assertions, pass `"artifacts/"`; for any session-scoped
 * collection, pass the collection prefix.
 */
export function findResourceChanges(
  items: OutputItem[],
  pathPrefix?: string
): Extract<OutputItem, { type: "resource_change" }>[] {
  const changes = itemsByType(items, "resource_change");
  if (pathPrefix === undefined) return changes;
  return changes.filter((item) => item.resourcePath.startsWith(pathPrefix));
}

/** Returns every `block_output` item produced by the named block. */
export function findBlockOutputs(
  items: OutputItem[],
  blockName: string
): Extract<OutputItem, { type: "block_output" }>[] {
  return itemsByType(items, "block_output").filter((item) => item.blockName === blockName);
}

/**
 * Asserts that a `testFlow` result completed cleanly and emitted no error
 * items. Combines the two signals a regression like the supervisor +
 * task-board infinite loop would trip: thrown errors land on `result.error`
 * (and may also be emitted as `error` items), and a non-completed status
 * surfaces as `result.status` ≠ `"completed"`.
 */
export function expectCompleted(result: TestFlowResult, vitestExpect: (actual: unknown) => any): void {
  vitestExpect(result.error).toBeUndefined();
  vitestExpect(result.status).toBe("completed");
  const errorItems = itemsByType(result.items, "error");
  vitestExpect(errorItems).toHaveLength(0);
}

/** Asserts that a `testFlow` result reported failure. */
export function expectFailed(
  result: TestFlowResult,
  vitestExpect: (actual: unknown) => any,
  errorMessageMatcher?: string | RegExp
): void {
  vitestExpect(result.status).toBe("failed");
  if (errorMessageMatcher !== undefined) {
    const errorMessage = result.error?.message ?? "";
    if (typeof errorMessageMatcher === "string") {
      vitestExpect(errorMessage.includes(errorMessageMatcher)).toBe(true);
    } else {
      vitestExpect(errorMessageMatcher.test(errorMessage)).toBe(true);
    }
  }
}

/**
 * Helper for predicate-style mock matching. Stringifies the input and tests
 * for the substring. Useful when a generator's `messages` array — the
 * default predicate input — embeds task goals or tool args inside nested
 * structures.
 */
export function inputContains(needle: string): (input: unknown) => boolean {
  return (input) => JSON.stringify(input).includes(needle);
}
