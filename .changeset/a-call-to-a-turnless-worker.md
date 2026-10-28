---
"@flow-state-dev/workforce": patch
---

A call (`sendMessage` with `wait: true`) to a worker whose `onMessageReceived` runs no turn no longer answers `{ status: "answered", reply: "" }`. It is refused with `no_reply` before anything is sent, or, where the sender can't tell up front, answers `{ status: "failed", error: "no_reply: …" }` once the message lands. A plain send to such a worker is unchanged. An `onMessageReceived` request with no turn now outputs `{ turnless: true }` instead of `{ reply: "" }` (FIX-2300).
