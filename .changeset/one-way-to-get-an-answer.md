---
"@flow-state-dev/workforce": minor
"@flow-state-dev/shift-manager": patch
---

Workers send messages with `sendMessage({ to, text, inReplyTo?, replyRequested?, wait?, deadline? })` (FIX-2318, FIX-2238, FIX-2310). A send that asks for a reply (`replyRequested: true`) goes on; the one answer comes back as a message. A send that waits (`wait: true`) asks the same way and waits in this turn: an answer before the deadline is the tool's result, `{ status: "answered", sent, reply, noAnswer? }`, and does not also land as a message; at the deadline the tool answers `{ status: "running", sent, recipient? }` and the answer arrives later as a message. The result key is `sent`. There is no wait-again and no `call` flag on the log row. A waited send to a worker that runs no turn on messages answers `{ status: "answered", noAnswer: true }` when the sender cannot tell up front, or is refused `no_reply` when it can. An answer whose sender still waits cannot itself ask for a reply (`reply_to_waiting`). `to` and `text` are required.

Shift Manager draws a reply request in Messages as *reply · waiting*, *reply · waiting on the user*, *reply · answered* or *reply · answered late*, and marks a received message that asks for a reply.
