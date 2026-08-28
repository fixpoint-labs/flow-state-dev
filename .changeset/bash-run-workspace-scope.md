---
"@flow-state-dev/tools": minor
---

The bash tool's local provider takes a fourth workspace scope, `"run"` — one workspace per request, shared with nothing (FIX-150).

`"session"` remains the default, so nothing existing changes shape. Reach for `"run"` when several agents work at once: every scope below it is a workspace two runs can be inside simultaneously, which is usually the point of a session but is also the only way one run sees another's half-finished files.

**`scope` and `cwd` cannot be set together.** A fixed directory is one workspace, so a scope alongside it separates nothing: each run still got its own registry entry and its own projection over the same files, each holding an independent baseline, and they read and flushed over each other while the configuration said they were isolated. The combination now throws at construction, naming both settings. Drop `cwd` for a workspace per scope, or drop `scope` to use the directory you named.

**`createBashTool` refuses `scope` outright.** Every scope is read off a block's execution context, and that factory returns plain AI SDK tools rather than blocks — it never sees one. It was accepting the option and ignoring it, handing back a single shared directory while the configuration named several isolated ones. Pass `cwd` to choose the directory, or use `createBashBlocks` for a scoped workspace.

**The `bash` tool description states the scope it was given.** It said "scoped to this session" whichever scope was configured, so an agent in a `run`-scoped workspace was told its files would be there next request. They will not be — the next request gets its own directory. The sentence is derived from `scope` now, which also stops it contradicting the capability's own prompt, which already named the scope correctly.
