---
"@flow-state-dev/core": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/claude-code": patch
"@flow-state-dev/cursor": patch
---

A running coding task's note says what its run is doing now, in words a person reads, the same for every harness (FIX-2984).

- **`HarnessActivity` gains `{ kind: "thinking" }`.** A harness reports a whole block of reasoning as thinking, with no text: a host can say the run is thinking, never what the model reasoned. `harnessActivityOf` maps Codex's and Cursor's `reasoning` event and Claude Code's `reasoning_complete` to it; reasoning deltas are still not activity. Claude Code reports each thinking block, and Cursor its reasoning, beside the tool calls they already reported. A host that switches over `activity.kind` handles a third kind.
- **The task's `statusNote` reads as a sentence.** harness-manager writes a tool call as what the run is doing to what: `Running pnpm test`, `Editing src/a.ts`, `Reading README.md`, `Searching "codename"`, `Fetching https://…`, `Updating the plan`, else `Using <tool>` and what it touches. Thinking reads `Thinking…`; a message still reads as its first line. It was `<tool>: <what it touches>` (`Edit: src/a.ts`).
- **The run's own phases are noted too.** A run notes `Preparing worktree…` as it starts, `Checking the work…` while its mode's completion check runs, and `Judge reviewing…` before a judge reads it, through the same fenced write, so a replaced attempt's note still declines. A retried task no longer shows its last attempt's note while the new one starts, and a completed task's last note is its last phase.

Docs: packages/core's harness reference (`HarnessActivity`, the `thinking` kind and what each harness reports) and apps/docs's harness-manager page (what a task's `statusNote` says while it runs, with the phase notes).
