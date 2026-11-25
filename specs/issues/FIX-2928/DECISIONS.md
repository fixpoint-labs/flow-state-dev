# FIX-2928 · Decisions

[Spec](SPEC.md) · **Decisions**

## D1 · `claudeCode()` becomes `claudeCodeHarness()`, and its collections are declared on the block

The epic's D2, carried out here. A kit can fill only the slots of kits it requires, so the
`claudeCode()` kit keeps `@flow-state-dev/claude-code` on harness-manager whatever we do with the
type. The kit does two things: it fills the `harnesses` slot with one or two harness values
(`plan: true` adds `claude-code-plan`), and it installs a `claude-code` flow carrying
`claudeCodeWorkRecorderResources` and `claudeCodeWorkspaceResources`.

- **The values.** `claudeCodeHarness({ plan?: boolean })` returns the value. An app that wants
  both fills both.
- **The collections.** Declared on the agent block (`claudeCodeAgent`) through its `resources`,
  so the coder flow that includes it installs them.

**Check first.** Before deleting the kit, the implementer confirms the run's writes reach the
same collections when they are installed by the coder flow rather than a dedicated flow (scope
and owning flow of the records). If they cannot, stop and report: the fallback is a tiny kit in
harness-manager that installs the flow, which is a decision for Jake, not the implementer.

## D2 · Fields only one runner fills are optional; `worktree` is required and both fill it

`onSteerable`, `onActivity` and `onEvent` are already optional on the task side "so a host that
wraps the feeds keeps compiling". `model` is filled only by the session runner today.
`worktree` is the one field FIX-2440 needs on both paths, so the task runner fills it now rather
than leaving a fence that works on one path only.

**If wrong:** a harness that needs `model` on task runs reads `undefined` and runs its own
default, which is what it does today.
