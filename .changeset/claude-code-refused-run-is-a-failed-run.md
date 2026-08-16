---
"@flow-state-dev/claude-code": patch
---

`runClaudeHeadless` now settles as failed when the harness refused the run a tool
it asked for. The Agent SDK ends a refused run with `subtype: "success"` — the
model is told the tool was denied, works around it, and stops normally — so an
unattended caller reading only the subtype recorded a completed run whose commit
was never made. The failure reason leads with *refused* and names every refused
call, so a missing permission reads differently from an agent that tried and
failed. `readTerminalResult` exposes the refusals as `permissionDenials` without
folding them into `succeeded`, so the flow-level agent path — where a host's own
`onToolApproval` denial is the host getting what it asked for — is unchanged.

<!-- TODO(linear): no issue covers this yet. File one and put its id in this body. -->
