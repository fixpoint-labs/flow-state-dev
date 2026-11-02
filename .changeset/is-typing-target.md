---
"@flow-state-dev/react": patch
---

`@flow-state-dev/react` exports `isTypingTarget(target)`: whether a key landed in an input, a text area, a select or editable text. A page-wide shortcut that is a printable key (`/`, `?`) checks it first, so the key stays text in a message box (FIX-2401).
