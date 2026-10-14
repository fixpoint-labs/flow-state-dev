---
"@flow-state-dev/shift-manager": patch
---

Rules view (FIX-1945): a worker on `agent` or a coordinator now has **Rules** on its Roster row (`/roster/<workerId>/rules`), and the Shift Coordinator's panel has a RULES section. Each lists the standing rules that worker keeps for the signed-in person, with when each was added and where it came from, and adds, edits and deletes them through the worker's own rules action. A worker on another flow says its flow doesn't keep rules.
