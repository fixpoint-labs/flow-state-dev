---
"@flow-state-dev/memory": patch
---

The episodic and semantic tiers take a `flowIsolation` option that overrides the flow's `isolateUserState` / `isolateOrgState` default for that tier alone, so one flow can keep its own episodes while sharing semantic facts with the person's other flows; the digest is isolated when either source is (FIX-1396).
