---
"@flow-state-dev/react": patch
"@flow-state-dev/devtool": patch
"@flow-state-dev/shift-manager": patch
---

A conversation opens at its end with no scroll animation: on mount, on a switch to another session, and when its first read fills it. Only content that arrives while the reader is at the end scrolls smoothly, and a reader who scrolled up stays where they are. `@flow-state-dev/react` exports the rule as `useFollowLatest({ resetKey?, startAtEnd? })`, returning `{ ref, atEnd, follow, stay }`. The DevTool's stream view and Shift Manager's conversations use it, so Shift Manager now glides to live content instead of jumping (FIX-2346).
