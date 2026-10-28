---
"@flow-state-dev/engine": patch
"@flow-state-dev/client": patch
---

Request routes answer a caller from another organization with the same 404 an unused request id gets, so a request's existence no longer shows across organizations (FIX-2194). The resume route records the signed-in caller as who resumed a suspension (the request's owner when the app doesn't authenticate) and ignores a `resumedBy` in the body; `ResumeSuspensionBody.resumedBy` is deprecated (FIX-2195).
