---
"@flow-state-dev/shift-manager": patch
---

Shift Manager no longer stops every coding run at 20 minutes (FIX-2977). With `DEVFORCE_LAB_RUN_MINUTES` unset, a run has no cap from the Lab: a quiet run stops after harness-manager's idle window, and a busy one runs up to harness-manager's default cap. Set `DEVFORCE_LAB_RUN_MINUTES` to cap runs tighter. The start line says `no Lab cap on run time` when none is set.
