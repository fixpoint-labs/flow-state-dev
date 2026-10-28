---
"@flow-state-dev/shift-manager": minor
---

Shift Manager's coordinator worker is now `shift-coordinator`, not `chief-of-staff`. Rename the folder `org/workers/chief-of-staff/` to `org/workers/shift-coordinator/` (or `teams/<team>/workers/chief-of-staff/` to `…/shift-coordinator/`). A Lab that still declares `chief-of-staff` has no Shift Coordinator: Shift Manager shows the line that says how to add one. The view's address is `/shift-coordinator` (it was `/cos`; an unknown path still opens the view), and its test ids start with `shift-coordinator-` instead of `cos-` (FIX-2244).
