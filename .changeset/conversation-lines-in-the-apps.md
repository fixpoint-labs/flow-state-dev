---
"@flow-state-dev/react": patch
"@flow-state-dev/shift-manager": patch
"@flow-state-dev/workforce": patch
---

Shift Manager draws its conversations from React's conversation model (FIX-2848).

- **react:** `conversationLines(items, turns, { renderers })` makes no line for a `data` item the given registry has no renderer for, or turns off (`false`): no renderer, no line. A record such as a task board's change no longer takes Retry off the failed turn before it. With no `renderers` given, every `data` item is still a line. `ItemsRenderer` hands a `toolGroupRenderer` the steps line itself as `line` (with `ended` once its turn is over), beside `items` and `live`.
- **shift-manager:** a worker's failed turn says why with a Retry when the engine retries it, and a turn you stopped says so after its last line. In a task's Session, a failed run says why with a Retry while the task stands failed on its board; Retry runs the task again there, as the task's own Retry does. A filed task's result shows where the board ended it. A message the worker sent is drawn from its own line only; a `sendMessage` call that wrote no line is a quiet tool line like any other.
- **shift-manager:** a worker's tool calls read in the same words as the other apps' (*Read src/a.ts*, *Read 2 files and searched the code*); a failed call that a later call of the same tool redid reads *Tried …*, and the run doesn't read as failed for it. A message to or from another worker keeps the time it landed and its link to Messages.
- **workforce:** `sentTargetLabel(to)` from `@flow-state-dev/workforce/browser` words who a sent message went to (a worker's id, `task <id>`, `conversation <id>`, else `another worker`), as the `workforce-lines` registry item's sent line does, for an app drawing its own look over it.
- **workforce:** a conversation's lines are drawn by two UI registry items, installed with `fsdev ui add conversation-lines workforce-lines`: `conversation-lines` holds the failed, stopped, approval and compact steps lines and one line context (`LineContext`) a screen sets for names, pictures, what a click opens and Retry; `workforce-lines` holds the sent, received, filed task and task ending lines and `withBrief`, which folds a task's brief to one line. `@flow-state-dev/workforce/react` no longer exports line renderers.
