---
"@flow-state-dev/react": patch
---

`useSession` reports `isLoading` on the first paint when a session id is given, and `useFlow` reports it on the first paint of its list read, so a transcript can hide until the snapshot lands (FIX-2218).
