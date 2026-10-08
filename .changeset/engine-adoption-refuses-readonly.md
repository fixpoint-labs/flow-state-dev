---
"@flow-state-dev/engine": minor
---

A dispatch that reaches a key-derived child session which already exists, asking for another value of one of its readonly session-state fields, is refused with `key-occupied`, naming the field, instead of adopting the session. Nothing is written and nothing runs there (FIX-1788).
