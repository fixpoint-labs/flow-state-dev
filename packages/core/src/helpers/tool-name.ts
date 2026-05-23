/**
 * Tool-name sanitization for provider compatibility.
 *
 * Framework tool blocks use a flexible naming convention that supports
 * namespacing via `.` and `/` (e.g. `tf.memory/recall`). Most LLM providers
 * — notably OpenAI — restrict tool names to `^[a-zA-Z0-9_-]+$`. We rewrite
 * any character outside that pattern to `_` before submitting to the model
 * and before listing the tool in any prompt context the model sees, so the
 * name surfaced to the model matches the name it must call.
 *
 * Sanitization is universal — applied regardless of provider — so flow
 * authors don't have to reason about which provider their flow will run
 * against. The framework retains the original name internally for
 * observability, item provenance, and tool-block routing.
 */

const TOOL_NAME_ALIAS_PATTERN = /[^a-zA-Z0-9_-]/g;

export function sanitizeToolName(name: string): string {
  return name.replace(TOOL_NAME_ALIAS_PATTERN, "_");
}
