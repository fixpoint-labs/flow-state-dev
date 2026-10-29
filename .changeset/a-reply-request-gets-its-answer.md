---
"@flow-state-dev/workforce": patch
---

`sendMessage` takes `replyRequested: true`: the sender asks for a reply and goes on without waiting. When the recipient's turn ends, its final text comes back to the sending session as an answer message (`inReplyTo` the original), unless the recipient answered with `sendMessage({ inReplyTo })` itself. An empty or failed turn, or one whose server stopped, answers "no answer" (`noAnswer: true` on the row). A send with `replyRequested` to a worker that runs no turn on messages is refused `no_reply`. Message log rows gain `replyRequested`, `answeredBy` and `noAnswer`; `messageReceivedSchema` and the `workforce:received` data gain `replyRequested`. A call (`wait: true`) is unchanged and never also answered as a message (FIX-2310).
