---
"@flow-state-dev/orchestration": minor
---

Delegation now has an on-demand **default worker** (the "floor"). A task whose `assignee` is unset or names no declared worker runs on a capable generic worker and records its result, instead of erroring out of the board. Two ways in: a skill that turns delegation on with `delegation: true` and declares no `agents:` gets a board whose only worker is the floor (delegation with no roster to hand-write), and a skill that declares a roster gets the floor wired as the board's fallback so an unnamed or unrecognized assignee is still handled. Declared workers are untouched — the floor is reached only on a genuine miss.

Under the hood, `taskBoard` gains an optional `defaultWorker` (wired as the worker router's `fallback`); non-delegation boards that don't set it still fail an unmatched assignee per `onError`, exactly as before.
