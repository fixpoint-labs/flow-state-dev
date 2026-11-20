---
"@flow-state-dev/core": patch
---

A streamed model call the provider refuses (an invalid key, a quota, a bad request) now fails with the provider's own reason instead of the AI SDK's generic "No output generated" (FIX-2867). The thrown `ModelStreamError` reads `Model provider error (401): <the provider's message>`, its `cause` is the provider's error (an `APICallError`, not `NoOutputGeneratedError`), and the serialized cause on an error item's `details` carries `statusCode`. API keys and bearer tokens in error messages are replaced with `[redacted]` wherever an error's cause chain is serialized for an item. Other stream failures keep the message "AI SDK stream failed".

Docs: none (error text only; no API change).
