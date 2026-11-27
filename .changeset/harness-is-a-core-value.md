---
"@flow-state-dev/core": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/claude-code": minor
"@flow-state-dev/codex": patch
"@flow-state-dev/cursor": patch
---

A harness is a core value, and the harness packages no longer depend on the harness manager (FIX-2928).

- **`@flow-state-dev/core/harness` exports `Harness`, `harnessSchema` and `HarnessFeeds`**, beside `HarnessBlock`, plus the tool-approval feed's types (`HarnessToolApprovalHook`, `HarnessToolApprovalRequest`, `HarnessToolApprovalDecision`). A harness package, or a harness of your own, imports these from core.
- **One feed type.** A task run and a session turn both hand a harness `HarnessFeeds`. Required: `cwd`, `resume`, `onSession`, `onUsage` and `worktree` (the run's directory, for a fence that names it; a task run now hands it too). Optional: `model` (a session turn's pick), `onSteerable`, `onActivity`, `onEvent`, `onToolApproval`.
- **Breaking:** `@flow-state-dev/harness-manager` no longer exports `Harness`, `HarnessFeeds`, `HarnessSessionFeeds` or the tool-approval feed types. Import them from `@flow-state-dev/core/harness`; `HarnessSessionFeeds` is `HarnessFeeds`. No alias.
- **Breaking: `claudeCode()` is gone; fill `claudeCodeHarness()` instead,** the way you fill `codexHarness()` and `cursorHarness()`: `fill: { [harnesses.slots.harnesses]: [claudeCodeHarness(), claudeCodeHarness({ plan: true })] }`. `plan: true` gives the `claude-code-plan` value. A run's work collections (`observed-file-ops`, `observed-gaps`, the plan record) are served by the flow that runs it, so there is no `claude-code` flow.
- `@flow-state-dev/codex` and `@flow-state-dev/cursor` drop their dependency on `@flow-state-dev/harness-manager`.

Docs: packages/claude-code/README.md · packages/harness-manager/README.md · apps/docs/docs/reference/kits.md, apps/docs/docs/reference/harness-runs.md and apps/docs/docs/build/webhooks/github-reviews.md (every `claudeCode()` becomes `claudeCodeHarness()` in the `harnesses` fill; the `claude-code` flow is gone)
