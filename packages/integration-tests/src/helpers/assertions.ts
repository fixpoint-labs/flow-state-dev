/**
 * Item-stream helpers for flow integration tests.
 *
 * Plain functions, not custom vitest matchers. Filtering by type and
 * extracting text from `MessageItem.content` parts is shared boilerplate
 * across scenarios; everything else stays in the test file so the
 * assertions speak for themselves.
 */
import type {
  BlockDebugItem,
  BlockOutputItem,
  OutputItem,
  RouterDecisionItem,
  StateSnapshotItem
} from "@flow-state-dev/core/items";

/**
 * Runtime item union — public `OutputItem` plus the four trace types.
 * Test runners surface trace items in `result.items`, so helpers that
 * filter that array need to accept the wider shape.
 */
type RuntimeItem =
  | OutputItem
  | BlockOutputItem
  | RouterDecisionItem
  | StateSnapshotItem
  | BlockDebugItem;

/** Returns every item of the given top-level `type`. */
export function itemsByType<T extends RuntimeItem["type"]>(
  items: RuntimeItem[],
  type: T
): Extract<RuntimeItem, { type: T }>[] {
  return items.filter((item): item is Extract<RuntimeItem, { type: T }> => item.type === type);
}

/** Returns the first message item with the given role, or `undefined`. */
export function findMessage(
  items: RuntimeItem[],
  role: "user" | "assistant" | "system" | "developer" | "tool"
): Extract<RuntimeItem, { type: "message" }> | undefined {
  return itemsByType(items, "message").find((item) => item.role === role);
}

/** Concatenates all `output_text` parts of a message item. */
export function messageText(item: Extract<RuntimeItem, { type: "message" }>): string {
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
export function findToolCalls(items: RuntimeItem[]): Extract<RuntimeItem, { type: "block_tool_output" }>[] {
  return itemsByType(items, "block_tool_output");
}

/**
 * Returns `resource_change` items whose path matches the given prefix.
 * For artifact assertions, pass `"artifacts/"`; for any session-scoped
 * collection, pass the collection prefix.
 */
export function findResourceChanges(
  items: RuntimeItem[],
  pathPrefix?: string
): Extract<RuntimeItem, { type: "resource_change" }>[] {
  const changes = itemsByType(items, "resource_change");
  if (pathPrefix === undefined) return changes;
  return changes.filter((item) => item.resourcePath.startsWith(pathPrefix));
}

/** Returns every `block_output` item produced by the named block. */
export function findBlockOutputs(
  items: RuntimeItem[],
  blockName: string
): Extract<RuntimeItem, { type: "block_output" }>[] {
  return itemsByType(items, "block_output").filter((item) => item.blockName === blockName);
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
