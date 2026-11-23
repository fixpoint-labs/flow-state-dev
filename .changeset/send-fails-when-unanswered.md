---
"@flow-state-dev/client": patch
---

A send the server never answers now fails instead of hanging (FIX-2866). `flow().send` waits up to 30 seconds for the server's answer to start; past that it aborts the request and rejects with a `ClientHttpError` of status 0, "The server didn't answer the send within 30 seconds." A message box on `useDraftSend` then gives Send back, keeps its text and shows the failure, so the person can retry. Set the limit with `createClient({ sendTimeoutMs })`; `0` waits for ever. Only the wait for the answer to start is timed: a streamed send that has started is never cut off.

Docs: packages/client/README.md and apps/docs/docs/api/client.md (the `createClient` options: `sendTimeoutMs`, and the status-0 refusal a send can reject with)
