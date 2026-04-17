---
sidebar_position: 5
---

# MCP (Model Context Protocol)

`@flow-state-dev/tools/mcp` — Connect MCP servers to your flows and expose their tools to generators, with built-in guidance for tool selection quality and per-turn tool gating.

## Install

MCP is already in `@flow-state-dev/tools`. Install the optional peer dependency to use it:

```bash
pnpm add @ai-sdk/mcp
```

## Configure a server

```typescript
import { createMcpCapability } from "@flow-state-dev/tools/mcp";

export const mcpCap = createMcpCapability({
  servers: [
    {
      name: "linear",
      description: "Project management: issues, projects, cycles, teams.",
      whenToUse: "User asks about tasks, tickets, or project work.",
      examples: [
        "To find open bugs: mcp__linear__list_issues({ filter: { state: 'open' } })",
      ],
      category: "project-management",
      transport: {
        type: "sse",
        url: "https://mcp.linear.app/sse",
        headers: { Authorization: `Bearer ${process.env.LINEAR_MCP_API_KEY}` },
      },
    },
  ],
});
```

Pass the capability to your generator:

```typescript
import { generator } from "@flow-state-dev/core";

export const myAgent = generator({
  uses: [mcpCap],
  // ...
});
```

## Metadata and selection quality

The per-server metadata fields feed both the description enrichment and the selection-guidance block that appears in the generator's system prompt.

| Field | Used for |
|---|---|
| `description` | Shown in the guidance block and (when `enrichDescriptions: "category"`) in tool descriptions. |
| `whenToUse` | Rendered as a "Use when: …" line in the guidance block. |
| `examples` | Rendered verbatim under the server's section. Writing examples that look like real calls moves selection quality more than any other single change. |
| `category` | Groups servers by category in the guidance block and (optionally) in tool descriptions. |

All fields are optional. Missing metadata falls back to a shorter, generic guidance block.

## Disabling tools at runtime

The capability contributes a `requestStateSchema`. Setting `ctx.request.state.mcp.*` narrows the tool list for that turn without touching connections:

```typescript
// Request payload includes: { state: { mcp: { disabledServers: ["linear"] } } }
// Linear tools are removed from the generator's tool list for this turn only.
```

For session-level persistence, pass a custom `filterTools` that composes over the default:

```typescript
import { createMcpCapability, defaultMcpFilterTools } from "@flow-state-dev/tools/mcp";

const mcpCap = createMcpCapability({
  servers: [/* ... */],
  filterTools: (ctx, tools) => {
    const sessionDisabled: string[] = ctx.session.state.mcpDisabledTools ?? [];
    const narrowed = defaultMcpFilterTools(ctx, tools);
    return (Array.isArray(narrowed) ? narrowed : narrowed).filter(
      (t) => !sessionDisabled.includes(t.name),
    );
  },
});
```

## Exposing the catalog

Use `createMcpManager` directly when you need the serializable catalog outside a capability — for example, to show users which servers are connected:

```typescript
import { createMcpManager, createMcpCapability } from "@flow-state-dev/tools/mcp";

const manager = createMcpManager({ servers: [/* ... */] });
const mcpCap = createMcpCapability({ manager });

// Call manager.getCatalog() anywhere you can serialize to the client.
```

## Presets

```typescript
mcpCap.presets({ guidance: false }); // tools only, no system-prompt block
mcpCap.presets({ tools: false });    // guidance only (rare — mostly useful for debugging)
```
