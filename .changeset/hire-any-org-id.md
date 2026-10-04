---
"@flow-state-dev/workforce": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/fsdev": minor
"@flow-state-dev/bullmq": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/node": patch
"@flow-state-dev/next": patch
"@flow-state-dev/vercel": patch
---

Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
