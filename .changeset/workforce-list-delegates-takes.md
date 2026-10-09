---
"@flow-state-dev/workforce": patch
---

A coordinator's `listDelegates` (the action and its turn's tool) now gives each delegate `takes`: `posts`, `tasks`, `both`, or `nothing` when it has been fired or its flow takes neither, read from the flow it runs on. The type is exported as `DelegateTakes`. A `handOff` refused for a delegate that can't take the post now ends by naming the delegates in the conversation that can, as in `Delegates here that take posts: eng.em.`, or `No delegate here takes posts.` (FIX-1826).
