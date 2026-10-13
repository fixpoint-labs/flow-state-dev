---
"@flow-state-dev/harness-manager": minor
---

A coding run's checkout folder and branch now include the organization the request was admitted under, so one person's runs in two organizations on one host no longer share a checkout or a branch; `RunPrincipal` requires `orgId`, and a run already under way keeps the branch its record names (FIX-1926).
