---
"@flow-state-dev/workspace": minor
---

Add `localWorkspaceHost`, which turns a run source's answer into a place a worker edits (a fresh branch of an allowed remote in `checkout/` with kept files in `project/`, or kept files alone in `workspace/`) and saves the kept files back, plus a `scope` on `Mount` that confines a projection to one key prefix of its collection (FIX-1762).
