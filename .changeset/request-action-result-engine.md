---
"@flow-state-dev/engine": patch
---

Store each request's action result (`output`, and/or `error`) on its record in the same write as its final status, and list it from `GET /sessions/:id/requests`, with the output only on `include_result_output=true` (FIX-1661).
