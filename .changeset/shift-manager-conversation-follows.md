---
"@flow-state-dev/shift-manager": patch
---

A conversation with a worker now follows its session's stream instead of reading the whole session every 5 seconds, so a message another worker sends, or a reply from another process, shows as soon as it is stored, and an open conversation reads nothing while nothing changes.
