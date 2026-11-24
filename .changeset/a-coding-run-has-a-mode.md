---
"@flow-state-dev/harness-manager": minor
---

A coding run's phase is now its mode (FIX-2877). The public word is mode; the old names are gone, with no alias.

- **Breaking: the renames.** `PhaseSpec` is `ModeSpec`, `PhaseDoneVerdict` is `ModeDoneVerdict`, `PhaseRunContext` is `ModeRunContext`, and the kit's `codingPhase` is `codingMode`. `harnessManager`'s `phase` option is `mode`, and a run context's `phase` field is `mode`.
- **Breaking: the shape.** A mode is `{ name, instructions, doneWhen }`. `name` was `phase`. `instructions` was `buildPrompt`. `doneWhen` holds what was three fields: `check` (was `isDone`), `timeoutMs` (was `doneTimeoutMs`) and `validate`. `commandCheck(mode, options)` takes and returns a mode. A session door's `runOf(row)` answers `{ issue, mode: { name, formerName? } }`.
- **The kit's mode is `default`.** A run of the harness kit's `coder` flow is now keyed `<epic>/<issue>/default`, and its branch and checkout end in `default`. Its runs were keyed `code` before. A run stored under `code` is still found there and finishes there, on its branch, checkout and coding session; nothing is moved or copied. A run that starts after the upgrade is keyed `default`.
- **`formerName` and `readModeRunRecord`.** A mode can name the segment its runs had before it was renamed (`formerName`), and `readModeRunRecord(ctx, epic, issue, mode)` finds a run under the mode's name first, then under that one.

Docs: packages/harness-manager/README.md and apps/docs/docs/orchestration/harness-manager.md (every `PhaseSpec`, `phase:` option, `buildPrompt` and `isDone` example becomes the mode shape)
