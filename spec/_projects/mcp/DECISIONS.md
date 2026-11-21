# Decisions — MCP

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Calls that bind more than one epic under this project. A call one epic owns lives in that epic's
spec. No `PD` card yet: one epic is filed, so no call made here binds a second.

## Decided once

- **One MCP server per flow kind, never one server spanning every flow.** Each flow with MCP
  enabled serves its own endpoint at `/api/flows/:kind/mcp`. This was decided before this
  project-spec existed: `@flow-state-dev/mcp` ships that shape, and FIX-2331 kept it as a lock
  when it replaced the canceled FIX-1333 and FIX-1384 on 2026-10-28. It binds the server-side
  epic and anything that exposes new tools over MCP, so neither has to argue it again.

## Open

None.
