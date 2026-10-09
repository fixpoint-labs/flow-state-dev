---
"@flow-state-dev/workforce": patch
---

A coordinator's `listDelegates` (the action and its turn's tool) now gives each delegate `description`, its worker's own description, and `takes`: `posts`, `tasks`, `both`, or `nothing` when it has been fired or its flow takes neither, read from the flow it runs on. A delegate that takes nothing, or a worker with no description, has a `description` of `null`. The type of `takes` is exported as `DelegateTakes`. A `handOff` refused for a delegate that can't take the post now ends by naming the delegates in the conversation that can, as in `Delegates here that take posts: eng.em.`, or `No delegate here takes posts.` A `hire`, `edit` or turn refused for a skill the installation doesn't register now names the skills it does, as in `Skills it registers: "cite", "summarize".`, or says `It registers no skills.` (FIX-1826).
