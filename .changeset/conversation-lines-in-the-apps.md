---
"@flow-state-dev/react": patch
"@flow-state-dev/shift-manager": patch
"@flow-state-dev/workforce": patch
---

Shift Manager draws its conversations from React's conversation model (FIX-2848).

- **react:** `conversationLines(items, turns, { renderers })` makes no line for a `data` item the given registry has no renderer for, or turns off (`false`): no renderer, no line. A record such as a task board's change no longer takes Retry off the failed turn before it. With no `renderers` given, every `data` item is still a line. `ItemsRenderer` hands a `toolGroupRenderer` the steps line itself as `line` (with `ended` once its turn is over), beside `items` and `live`.
- **shift-manager:** a worker's failed turn says why with a Retry when the engine retries it, and a turn you stopped says so after its last line. A filed task's result shows where the board ended it. A message the worker sent is drawn from its own line only; a `sendMessage` call that wrote no line is a quiet tool line like any other.
- **workforce:** `sentTargetLabel(to)` from `@flow-state-dev/workforce/browser` words who a sent message went to (a worker's id, `task <id>`, `conversation <id>`, else `another worker`), as workforce's own sent line does, for an app drawing its own look over it.
