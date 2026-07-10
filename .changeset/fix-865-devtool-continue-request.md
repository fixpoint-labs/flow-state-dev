---
"@flow-state-dev/react": patch
---

`useSession` now exposes `continueRequest(requestId)` (FIX-865), which continues a crash-interrupted request under its own id and streams the re-entry back into `session.items` — distinct from `resumeLatestRequest`, which re-dispatches the session's most recent request via `/retry` under a new id. `ItemRenderer`'s built-in non-renderable set now also suppresses the `continuation` item type, so a crash-continue's re-entry marker doesn't fall through to the JSON dev-fallback render.
