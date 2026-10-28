---
"@flow-state-dev/workforce": patch
---

A worker whose last plan step ran in a session of its own (`session: "new"`) now gets its answering turn once that step ends, and its request returns that answer. Before, the request finished with the turn's earlier answer and the step's result never reached it (FIX-2110).
