---
"@flow-state-dev/engine": minor
"@flow-state-dev/node": minor
---

FIX-2806: The router refuses browser cross-site mutations (`Sec-Fetch-Site: cross-site` on POST, PUT, PATCH or DELETE) with 403; inbound transport routes are left to their adapters. A Node server bound to loopback refuses requests whose Host header is not a loopback name with 403, which stops DNS rebinding.
