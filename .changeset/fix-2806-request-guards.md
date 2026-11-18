---
"@flow-state-dev/engine": minor
"@flow-state-dev/node": minor
---

FIX-2806: The router refuses browser cross-site mutations (`Sec-Fetch-Site: cross-site` on POST, PUT, PATCH or DELETE) with 403; inbound transport routes are left to their adapters. A Node server bound to loopback refuses requests whose Host header is not a loopback name with 403, which stops DNS rebinding. JSON routes refuse a non-empty body that isn't sent as `content-type: application/json` with 415, so a browser can't skip the CORS preflight with a `text/plain` post. Callers that post a body must send that header; `@flow-state-dev/client` already does.

Docs: apps/docs/docs/server/setup.md (the two `curl -X POST ... -d` examples under the instance-session section need `-H "content-type: application/json"`; any page showing a `curl -d` or bare `fetch` POST to a flow route must send that header). FIX-2806.
