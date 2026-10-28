---
"@flow-state-dev/workforce": minor
---

A task on a conversation board that asks a question midway now tells the worker that filed it: one message per question, from the task's worker, landing in the conversation that filed the task (FIX-2241). It names the task and the question's id, so the filer can answer with `updateTask({ id, question, message })` without reading the task first; a task routed to a workstream says the user answers it from their Inbox instead. The message costs no budget, and a replayed turn sends no second copy. The Inbox item stays the one stop. `sendMessage` takes `exempt: true` for a message your server sends on its own, which spends no budget; never pass it for a model's send.
