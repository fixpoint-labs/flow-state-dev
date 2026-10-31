---
"@flow-state-dev/react": patch
---

`@flow-state-dev/react` exports `isSendKey(event, { enterSends? })`, the send shortcut for a message box: Cmd+Enter (Mac) or Ctrl+Enter (elsewhere) always sends, plain Enter sends only where `enterSends` is set, and Shift+Enter or an Enter that confirms an IME composition never sends.
