---
"@flow-state-dev/workforce": minor
"@flow-state-dev/shift-manager": patch
---

**Breaking:** a worker has one way to get an answer from another worker (FIX-2318). `sendMessage({ to, text, wait: true, deadline? })` now asks for a reply exactly as `replyRequested: true` does, and waits for that one answer in the same turn. The recipient reads the reply-request prompt and answers the same way, with its final text or its own `sendMessage({ inReplyTo })`. An answer that comes before the deadline is the tool's result, `{ status: "answered", sent, reply, noAnswer? }`, and doesn't also land as a message. At the deadline the tool answers `{ status: "running", sent, recipient? }`, and the answer comes back later as a message, like any reply.

Removed: the separate call. `sendMessage` no longer takes `callId` (waiting again is gone; the late answer arrives as a message), the result's `callId` is now `sent`, and the errors `no_such_call`, `wait_again_only` and `missing_message` are gone (`to` and `text` are required). The message log row loses `call` and `repliedAt`; a waited message has `replyRequested: true`, `deadlineAt`, and `waitEndedAt` once its wait ended with no answer yet. `MessageReceived` and the `workforce:received` component data lose `call`. A waited send to a worker that runs no turn on its messages, where the sender can't tell up front, now answers `{ status: "answered", noAnswer: true }` with the framework's "no answer" instead of `failed` with `no_reply`.

Shift Manager draws a reply request's state in Messages as *reply · waiting*, *reply · waiting on the user*, *reply · answered* or *reply · answered late* (was *call · …*), marks a received message that asks for a reply *asks for a reply · the reply goes back*, and drops the *Waited again* line.
