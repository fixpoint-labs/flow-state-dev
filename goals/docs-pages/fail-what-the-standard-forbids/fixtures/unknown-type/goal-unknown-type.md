---
title: A page of no known type
type: guide
---

# A page of no known type

A request reads the session record before the first block runs. Each user keeps one record per organization, and the session names it. The org record holds what every user in the organization shares. A block that writes session state writes it for the whole conversation.

Request state starts empty and goes when the call ends. Two users at the same org read the same org record and different user records. A field the flow does not expose never reaches the browser. The schema on the flow gives each field its type and its default.

A request reads the session record before the first block runs. Each user keeps one record per organization, and the session names it. The org record holds what every user in the organization shares. A block that writes session state writes it for the whole conversation.
