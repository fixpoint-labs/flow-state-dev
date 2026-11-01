---
"@flow-state-dev/react": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/shift-manager": patch
---

`@flow-state-dev/react` exports `useInterruptKeys`, `createInterruptKeys` and `interruptChordLabel`, a keyboard stop for long-running work. One Esc never stops anything. A second Esc within 1.5 s does, and so does Cmd/Ctrl+. at once. An Esc typed in a text field, or one already used to close a dialog, never counts (FIX-2413).

`@flow-state-dev/engine`: the request status route's `completedAtMs` is now set for aborted and failed requests, from the time they stopped. It was set only for requests that completed. A replayed or resumed stream's terminal event for an aborted request is now dated when the request was aborted, not when its record was last written.

`@flow-state-dev/shift-manager`: one Esc on a task no longer interrupts its run. Press Esc twice or Cmd/Ctrl+. instead. Esc in the composer is the composer's. An interrupted run now says when it stopped.
