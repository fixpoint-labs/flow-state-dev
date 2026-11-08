---
"@flow-state-dev/codex": minor
"@flow-state-dev/cursor": minor
---

The Codex and Cursor package roots now match Claude Code's: the run's cost is read from its handle, and the handle, its source, the client seam and the error classes are documented public API (FIX-2605).

- **Removed from the root, with no alias:**
  - `estimateCodexCost` (`@flow-state-dev/codex`). Read the run's estimate from the block's handle instead: `handle.cost` (`{ usd, … }`, or `null` when it cannot be priced). The block fills it with the same price-table estimate.
  - `estimateCursorCost` (`@flow-state-dev/cursor`). Read `handle.cost` on the Cursor block's handle the same way.
- **Documented on the root, unchanged:**
  - The handle a run returns: `CodexAgentHandle` and its runtime validator `codexAgentHandleSchema`, whose `source` is `CODEX_SOURCE` (`"codex/sdk"`) and whose `codexUsage` is a `CodexRunUsage`. Cursor's is `CursorAgentHandle`, `cursorAgentHandleSchema`, `CURSOR_SOURCE` and `CursorRunUsage`. These match Claude Code's `ClaudeCodeAgentHandle`, `claudeCodeAgentHandleSchema` and `CLAUDE_CODE_SOURCE`.
  - Cursor's client seam: `createDefaultResolveCursorClient(importer)` builds the default `resolveCursorClient` from a `CursorSdkImporter`, as Codex's `createDefaultResolveCodexClient` and Claude Code's `createDefaultResolveClaudeCodeAgent` do.
  - The error classes, vendor detail beside core's readers (`isAbortLike`, `harnessFailureKind`): Codex's `CodexAgentConfigError` (a refused option, when the block is built) and `CodexSdkNotInstalledError` (the SDK is absent, on the first run), beside `CodexAgentRunError` and `CodexAgentAbortedError`. Cursor's `CursorAgentConfigError`, `CursorSdkNotInstalledError` and `CursorAgentRunError`, beside `CursorAgentAbortedError`.

Docs: packages/codex/README.md (`handle.cost` replaces `estimateCodexCost`; the handle section names `CodexAgentHandle`, `codexAgentHandleSchema`, `CODEX_SOURCE` and `CodexRunUsage`; the errors section names `CodexAgentConfigError` and `CodexSdkNotInstalledError`), packages/cursor/README.md (`handle.cost` replaces `estimateCursorCost`; the handle section names `CursorAgentHandle`, `cursorAgentHandleSchema`, `CURSOR_SOURCE` and `CursorRunUsage`; the client seam names `createDefaultResolveCursorClient` and `CursorSdkImporter`; the errors section names `CursorAgentConfigError`, `CursorSdkNotInstalledError` and `CursorAgentRunError`), apps/docs/docs/tools/codex.md and apps/docs/docs/tools/cursor.md (the run's cost is `handle.cost`)
