# Plan — MCP

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

The order the epics run in, what each hands the next, and what is deliberately not next. Status is
[the epics table](SPEC.md)'s; this page does not repeat it.

## The arc

Two lanes, no bars yet: FIX-2615 has not started in Linear and the other lane is not filed. The
arc becomes a figure once a second epic is filed and gives it an order to show.

| Lane | Consumes | Releases |
|---|---|---|
| **connectors, and what a project is** · FIX-2615 | Workforce's project-scoped MCP as it stands: a project's server list, the one MCP client its workers and coding runs share, and the per-user key route | Connectors installed at the host, projects that enable them, and one written definition of each that the next epic reads |
| **flow servers proven on real clients** · FIX-XXX | `@flow-state-dev/mcp`, the per-flow server from FIX-22 | A server proven on several real clients, with fixes, docs, an example beyond Kitchen Sink and a reference deployment |

The lanes are independent. FIX-2615 runs first because it is the one running now, and the
teammates lab is its first consumer.

## What is deliberately not next

- **Workforce tools over MCP.** FIX-2331 is the Shift Manager project's. It rides on the server
  lane and does not move here.
- **More third-party connectors beyond Linear.** The connector model comes first; which servers
  to support is a later call.
- **A Linear Agents connector.** FIX-567 is a different protocol, not MCP work.
