---
"@flow-state-dev/tools": minor
---

The bash tool's local provider takes a fourth workspace scope, `"run"` — one workspace per request, shared with nothing (FIX-150).

`"session"` remains the default, so nothing existing changes shape. Reach for `"run"` when several agents work at once: every scope below it is a workspace two runs can be inside simultaneously, which is usually the point of a session but is also the only way one run sees another's half-finished files.
