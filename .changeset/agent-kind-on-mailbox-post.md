---
"@flow-state-dev/workforce": patch
---

The built-in `agent` kind now declares an internal `onMailboxPost` entry, so a mailbox's notify block can dispatch a post to an agent seat and have it answer with the post as its turn (FIX-1590).
