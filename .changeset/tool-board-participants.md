---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/core": patch
---

Assign a delegation task directly to a tool. An entry in a skill's `agents:` map can now
resolve with `tool: <catalog key>` alongside `prompt` / `prompt-ref` / `agent-ref`. The board
invokes that tool directly with the task's `input` as its arguments and records the return
value as the task's output, with no model turn.

Tool and agent keys share one assignee namespace, so a tool is a valid `addTask` assignee and
appears in the coordinator's roster marked as deterministic. A tool task gets dependency
ordering from `deps` but does not receive an upstream task's output; a step that needs one
stays an agent.

A `tool` entry carrying agent-only fields (`prompt`, `model`, `visibility`, `context-supply`,
`tools`, `agent-overrides`) is rejected when the skill is parsed, and a `tool` naming an
absent catalog key — or one that resolves to a generator — fails loud at build time for a
static skill and at materialization for a runtime activation. Skills with no `tool` entries
parse and materialize exactly as before.
