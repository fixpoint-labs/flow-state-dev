---
"@flow-state-dev/react": patch
"@flow-state-dev/devtool": patch
"@flow-state-dev/shift-manager": patch
---

New content never scrolls a conversation, even when the reader is at the end; a jump-to-latest arrow appears instead. A conversation still opens at its end with no scroll animation: on mount, on a switch to another session, and when its first read fills it. Sending your own line takes you to the end. `@flow-state-dev/react` exports the rule as `useJumpToLatest({ resetKey?, startAtEnd? })`, returning `{ ref, atEnd, jump, sent }`. The DevTool's stream view and Shift Manager's conversations use it (FIX-2346, FIX-2360).
