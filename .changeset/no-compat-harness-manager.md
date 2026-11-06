---
"@flow-state-dev/harness-manager": patch
---

`harnessManager` no longer refuses the removed `announce` option; it is an unknown option that nothing reads. Read held tasks from the board (`openRowHolds`) (FIX-2454).

Docs: packages/harness-manager/README.md (drop "`harnessManager({ announce })` is refused at construction"). The old name is removed outright, with no refusal message.
