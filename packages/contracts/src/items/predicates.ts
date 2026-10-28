/**
 * Predicate helpers for the sequencer `.waitForCondition(...)` op. Each helper
 * returns `(items) => boolean`, an over-the-stream predicate that the runtime
 * evaluates once at entry and again on every item event until it returns true
 * (or the timeout fires).
 *
 * These are deliberately small and total: no allocations on the hot path, no
 * exceptions on malformed items, no async. Predicate authors that need richer
 * matching can hand-write a closure — these cover the common cases.
 */

import type { OutputItem, ResourceChangeItem, SuspensionItem, SuspensionResumeItem } from "./types";

/**
 * Convert a tiny glob — `**` (any path), `*` (any single segment) — into an
 * anchored RegExp. Intentionally minimal: bracket classes, `?`, escaping, and
 * brace expansion are out of scope. Other regex metacharacters in `pattern`
 * are escaped so they match literally.
 */
function globToRegExp(pattern: string): RegExp {
  // Reserve placeholders for `**` and `*` before regex-escaping so the
  // escape pass doesn't mangle the wildcards. NUL-wrapped so the sentinel
  // cannot collide with anything a caller's pattern contains.
  //
  // Written as the escape sequence, never as a literal NUL byte: git sniffs a
  // file's first 8000 bytes for one and renders the whole file as `Bin` if it
  // finds it, which costs every reviewer the diff of this file.
  const DOUBLE_STAR = "\u0000DOUBLESTAR\u0000";
  const SINGLE_STAR = "\u0000SINGLESTAR\u0000";
  const withPlaceholders = pattern
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, SINGLE_STAR);
  const escaped = withPlaceholders.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const expanded = escaped
    .replace(new RegExp(DOUBLE_STAR, "g"), ".*")
    .replace(new RegExp(SINGLE_STAR, "g"), "[^/]*");
  return new RegExp(`^${expanded}$`);
}

function isResourceChange(item: OutputItem): item is ResourceChangeItem {
  return item.type === "resource_change";
}

/**
 * True if any item in the stream is a `resource_change` whose `scope` and
 * `resourcePath` match exactly. When `changeType` is supplied, the change
 * kind (`"created"`, `"updated"`, `"deleted"`) must also match.
 *
 * Used to suspend a sequencer until a specific resource mutation reaches the
 * request stream — for example, waiting for a worker pattern to write its
 * artifact before the supervisor reads it.
 */
export function whenResourceChanged(criteria: {
  scope: ResourceChangeItem["scope"];
  path: string;
  changeType?: ResourceChangeItem["changeType"];
}): (items: readonly OutputItem[]) => boolean {
  return (items) => {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!isResourceChange(item)) continue;
      if (item.scope !== criteria.scope) continue;
      if (item.resourcePath !== criteria.path) continue;
      if (criteria.changeType !== undefined && item.changeType !== criteria.changeType) continue;
      return true;
    }
    return false;
  };
}

/**
 * True if at least one item in the stream satisfies `predicate`. The generic
 * escape hatch for cases where the more specific helpers don't fit.
 */
export function whenAnyItem(
  predicate: (item: OutputItem) => boolean
): (items: readonly OutputItem[]) => boolean {
  return (items) => {
    for (let i = 0; i < items.length; i += 1) {
      if (predicate(items[i])) return true;
    }
    return false;
  };
}

/**
 * True if any `resource_change` item's `resourcePath` matches `pattern` under
 * the given `scope`. `pattern` supports `*` (single path segment) and `**`
 * (any number of segments). Use this when the path is templated — e.g.,
 * `artifacts/*` or `workers/**\/done`.
 */
export function whenResourceMatching(criteria: {
  scope: ResourceChangeItem["scope"];
  pattern: string;
}): (items: readonly OutputItem[]) => boolean {
  const regex = globToRegExp(criteria.pattern);
  return (items) => {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!isResourceChange(item)) continue;
      if (item.scope !== criteria.scope) continue;
      if (regex.test(item.resourcePath)) return true;
    }
    return false;
  };
}

/**
 * True when `item` is a suspension item (`type === "suspension"`).
 * Use to narrow `OutputItem` to `SuspensionItem` without string-matching `item.type`.
 */
export function isSuspensionItem(item: OutputItem): item is SuspensionItem {
  return item.type === "suspension";
}

/**
 * True when `item` is a suspension resume item (`type === "suspension_resume"`).
 * Use to narrow `OutputItem` to `SuspensionResumeItem` without string-matching `item.type`.
 */
export function isSuspensionResumeItem(item: OutputItem): item is SuspensionResumeItem {
  return item.type === "suspension_resume";
}

/**
 * True when `item` is a tool call waiting on an approval or a question, not a
 * failed one. A tool that calls `ctx.suspend()` is recorded as a failed
 * `tool_output` whose `error.code` is `"SUSPENSION"`, with the suspension's message as
 * its error; its real result replaces it once the answer resumes the run.
 * Renderers use this to draw the wait as waiting rather than as an error.
 */
export function isSuspensionWait(item: { readonly type: string; readonly status?: string; readonly error?: { readonly code?: string } }): boolean {
  return item.type === "tool_output" && item.status === "failed" && item.error?.code === "SUSPENSION";
}
