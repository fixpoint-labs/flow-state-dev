---
"@flow-state-dev/workforce": patch
---

The built-in `agent` kind now declares an internal `onChannelPost` entry, so a channel's notify block can dispatch a post to an agent seat and have it answer with the post as its turn (FIX-1590).
