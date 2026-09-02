---
"@flow-state-dev/engine": patch
---

Keep the serverless function alive while a resumed request finishes.

`host.continueRequest` now registers its background `finished` promise with
`onBackgroundWork` (→ Next `after()` / Vercel `waitUntil`), exactly as
`host.dispatch` already did. The resume route returns `202` without awaiting the
inline continuation, so on freeze-after-response platforms (Vercel, where the
continuation runs in-process — no BullMQ) the resumed run previously stalled when
the response was sent and only completed when a later invocation thawed the
container. Symptom: a resume appeared to hang for ~20s, the flow's remaining
steps did not run, and a page refresh still showed `in_progress` until the next
request kicked it. The continuation is now kept alive to completion like a normal
dispatch.
