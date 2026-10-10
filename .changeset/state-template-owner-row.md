---
"@flow-state-dev/engine": patch
---

`GET /sessions/:id/state` no longer renders another user's owner-private row through a `contentTemplateRef`. The snapshot now reads the same rows a run's cache holds for the session's user, so a template pointing at an owner-keyed storage key resolves only for that row's owner (FIX-1568).
