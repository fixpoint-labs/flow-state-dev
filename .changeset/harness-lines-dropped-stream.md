---
"@flow-state-dev/react": patch
---

`useHarnessLines`: when the running turn's stream drops while a line's turn waits behind it, the hook follows the running turn again (up to three times), so the waiting turn's answer shows when the running one ends instead of only after a reload (FIX-2304).
