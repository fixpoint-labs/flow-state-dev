---
"@flow-state-dev/tools": minor
---

`createBashBlocks()` now runs in the just-bash emulator when no `provider` is given, the same default as `createBashCapability()` and `createBashTool()` (FIX-2818).

- **Breaking: the host shell is an explicit choice.** It was the default. A caller that relied on it passes `provider: { type: "local" }`. There is no alias for the old default.
- **Install `just-bash` to run commands on the default.** It is an optional peer dependency of `@flow-state-dev/tools`. Without it, the default sandbox still reads and writes files but refuses commands, with `install just-bash for full bash support` on stderr. That is the same fallback `createBashCapability()` and `createBashTool()` already have.

Docs: apps/docs/docs/reference/tools.md (the "Default provider" column for `createBashBlocks` reads `just-bash`, not `local`).
