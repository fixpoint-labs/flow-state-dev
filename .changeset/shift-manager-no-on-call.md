---
"@flow-state-dev/shift-manager": patch
---

Shift Manager drops On Call. A worker is on shift or off shift: one running a task, or waiting on you with a parked task or a pending ask, is on shift. Roster's last column is WAITING ON YOU, and the on-call counts, the Shift Coordinator's ON CALL list and its "Who's on call?" suggestion are gone. The DevTeam Lab no longer has an `ops.oncall` worker (FIX-1964).
