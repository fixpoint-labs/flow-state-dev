---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/core": patch
---

Assign a delegation task directly to a tool. Every tool a delegating skill allows is now a
board seat, named by its catalog key — the keys in its `allowed-tools`, or the whole catalog
when it declares none. Nothing is declared for this: the board invokes the tool with the
task's `input` as its arguments and records the return value as the task's output, with no
model turn.

Tool keys and agent keys share one assignee namespace, so a tool is a valid `addTask`
assignee and a same-named agent shadows it. A tool task gets dependency ordering from `deps`
but does not receive an upstream task's output; a step that needs one stays an agent. The
assignment gate now validates against agents plus assignable tools, so a board with tools but
no declared agents refuses a typo'd assignee instead of quietly running it on the default
worker.

The coordinator's guidance spends one sentence on assignable tools rather than a roster line
per tool, so it no longer scales with the size of the app's catalog.

Assignee keys may now contain uppercase (`/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`), since catalog keys
are camelCase by convention. The leading-alphanumeric anchor is unchanged, so the board's
reserved routes stay unclaimable. Existing lowercase keys are unaffected.
