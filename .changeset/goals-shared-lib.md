---
---

Internal only — no published package changes.

Adds `goals/lib`, a small shared utility surface for the goal-check library, and migrates all 25 runners onto it. Also adds `pnpm goal:all` (the sweep the goals README has promised since the library was created) and puts `goals/` under `pnpm typecheck` for the first time.

Two latent defects surfaced and fixed in the process: two runners stripped only three named `FSDEV_INTENT_*` keys instead of the whole prefix (so any other pinned intent broke them), and the two capture-reading runners took the FIRST item snapshot rather than the latest, contradicting the technique their own template documents.
