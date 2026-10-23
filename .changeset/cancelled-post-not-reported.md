---
"@flow-state-dev/workforce": patch
---

A delegate's task whose run the user cancels now ends `cancelled` instead of `errored`, so it no longer owes the Error Reporter a report; `ERROR_REPORTER_FLOW` is exported from `@flow-state-dev/workforce/browser` (FIX-2051).
