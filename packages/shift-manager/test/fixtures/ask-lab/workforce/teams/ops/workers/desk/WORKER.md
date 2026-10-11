---
description: Where the ops team takes requests.
flow: coordinator
delegates: [ops.asker, ops.helper]
routing: everyone
---

Requests land here. Every worker here asks a user before it acts.
