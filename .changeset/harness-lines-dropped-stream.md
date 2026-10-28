---
"@flow-state-dev/react": patch
---

`useHarnessLines`: when the running turn's stream drops while a line's turn waits behind it, the hook follows the running turn again (up to three times), so the waiting turn's answer shows when the running one ends instead of only after a reload (FIX-2304). `useSession.followRequest` on a request whose stream dropped picks up after the last event the view had, instead of replaying it from the start and applying its state changes twice. `followRequest` now returns `false`, and follows nothing, for a request the person stopped; `useHarnessLines` then moves on to the waiting turn.
