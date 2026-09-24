---
"@flow-state-dev/devtool": minor
---

An Inventory tab on any session whose flow declares a readable inventory collection: the organization's registered seats (with their kind and channels), channels (with their members and registration time) and memberships, read through the production collection route with the configured bearer token, so it works with the debug endpoints off. A collection the flow does not declare reads "not installed on this flow", and a refused read names its status (FIX-1502).
