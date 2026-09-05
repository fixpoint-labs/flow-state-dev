---
"@flow-state-dev/tools": patch
---

The built-in `fetch` and `crawl` providers now reach public network addresses only, validating each redirect hop and each crawled link. Requests to loopback, link-local, and private ranges are rejected instead of served.
