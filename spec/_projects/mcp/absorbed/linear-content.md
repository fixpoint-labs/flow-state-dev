<!-- Verbatim snapshot. Do not edit, reflow, or fold. -->

# Linear project `content`, as read

**Read** 2026-11-10 from the Linear project
[MCP](https://linear.app/fixpoint-labs/project/mcp-1b3690651b5d)
· project `updatedAt` **2026-08-25T00:30:37.471Z**

Everything below the rule is the field exactly as the API returned it, before the project-spec
mirror replaced it. What was folded into the four documents, and what was left behind, is in the
project PR's body and in the `absorbed:` line of the build report.

---

A solid, tested, documented MCP (Model Context Protocol) integration for `@flow-state-dev`. Core MCP server work shipped recently ([FIX-22](https://linear.app/fixpoint-labs/issue/FIX-22/mcp-server-integration-expose-flows-as-mcp-servers)) but has not yet been thoroughly tested in production scenarios; this project is the wrap-up to a real release.

## What this enables

Developers can expose any flow as an MCP server with a single primitive — turning their FSD flows into tools that any MCP client (Claude Desktop, Claude Code, Cursor, third-party agents) can invoke directly.

## Scope

* Production hardening of the MCP server transport that already shipped
* Real-world testing across multiple MCP clients (Claude Desktop, Claude Code, etc.)
* Follow-up issues filed during testing
* Documentation, examples, and a reference deployment
* Optional: outbound MCP client work if it surfaces as needed

## Why this matters

MCP is a fast-emerging interop standard. Shipping a polished, production-ready MCP integration is a significant differentiator for FSD against frameworks that haven't yet treated MCP as a first-class transport.

## Done when

The MCP integration is exercised against multiple real clients without regressions, has documentation that matches its actual behavior, and ships with a working example beyond kitchen-sink.
