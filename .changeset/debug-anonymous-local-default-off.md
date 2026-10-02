---
"@flow-state-dev/engine": minor
---

The debug endpoints no longer admit requests without an `Origin` header by default (FIX-1710). `debugAllowAnonymousLocal` now defaults to `false`; opt in with `debugAllowAnonymousLocal: true` on `createFlowApiRouter` or `createFlowState`, or set `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL=1`, and only on a server bound to loopback. `fsdev dev` opts in for you, so the DevTool keeps working there. A self-hosted DevTool page that reads the debug endpoints from the same origin sends no `Origin` header, so it needs the opt-in.
