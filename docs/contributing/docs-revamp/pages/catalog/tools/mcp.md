---
title: MCP tools
type: catalog
description: Connect an MCP server and give its tools to a generator.
---

# MCP tools

Connect an MCP (Model Context Protocol) server and your generator can call its tools. `@flow-state-dev/tools/mcp` also adds a section to the generator's system prompt that tells the model when to use each server, and lets you switch servers off for a single request.

Only a server's tools come through. Its prompts and resources do not.

## Install it

MCP is already in `@flow-state-dev/tools`. Install the optional peer dependency to use it:

```bash
pnpm add @ai-sdk/mcp
```

## Use it

Describe each server once, in a capability. A capability is a bundle of tools and prompt text that a block attaches with `uses`.

```typescript title="src/lib/mcp.ts"
import { createMcpCapability } from "@flow-state-dev/tools/mcp";

export const linear = {
  name: "linear",
  description: "Project management: issues, projects, cycles, teams.",
  whenToUse: "User asks about tasks, tickets, or project work.",
  examples: [
    'To find issues about login: mcp__linear__list_issues({ query: "login" })',
  ],
  category: "project-management",
  transport: {
    type: "http" as const,
    url: "https://mcp.linear.app/mcp",
    headers: { Authorization: `Bearer ${process.env.LINEAR_MCP_API_KEY}` },
  },
};

export const mcpCap = createMcpCapability({ servers: [linear] });
```

`transport.type` is `"http"` (Streamable HTTP) or `"sse"`. Use `"http"` unless your provider only offers SSE, and check the provider's docs for its endpoint. A server's own key goes in `transport.headers`.

Then attach the capability to a generator:

```typescript title="src/flows/support/blocks/triage.ts"
import { generator } from "@flow-state-dev/core";
import { mcpCap } from "../../../lib/mcp";

export const triage = generator({
  name: "triage",
  model: "openai/gpt-6-luna",
  prompt: "Help the user find and sort their project work.",
  uses: [mcpCap],
});
```

Each tool a server publishes becomes a tool named `mcp__<server>__<tool>`, such as `mcp__linear__list_issues`. The server describes its arguments and checks them, not Flow State.

Nothing connects when you build the flow. The first request that needs the tools connects every server, in parallel.

A generator that declares its own `tools` list gets only the tools on that list. The capability's tools are dropped, though its system-prompt section arrives. Leave `tools` off the generator, as above.

## What the model is told

The capability adds a section to the generator's system prompt listing each connected server and when to use it. `description`, `whenToUse`, `examples` and `category` fill it in, and all four are optional. An example is shown to the model word for word, so write it as a real call with realistic arguments. The [Tools reference](../../reference/tools.md) lists how each field renders and what the section says when a server has none.

## When a server is down

One failed server does not stop the others. Say the docs-search server is down at startup and Linear is up:

- The model gets Linear's tools and none from docs-search.
- Your logs get one warning, `[mcp] Failed to connect to "docs-search": <message>`.
- The system-prompt section lists only Linear.
- `manager.getCatalog()` shows docs-search as `errored`, with the error text. Header values, such as your key, are removed from it.

The server does not come back by itself. The result of the first attempt is kept, and there is no retry or reconnect option on the server config. Calling `manager.close()` on a manager you built (see below) resets every server, and the next `getTools()` connects again.

## Turn tools off for one request

A request's state can carry `mcp.disabledServers`, a list of server names, and `mcp.disabledTools`, a list of full tool names such as `mcp__linear__list_issues`. Either drops those tools from the generator's list for that request only. The connections are kept, and a name that matches nothing is ignored.

To turn tools off for a whole session, pass `filterTools`. It receives the block's context and the tool list and returns the list to use. Call `defaultMcpFilterTools` first to keep the request-state behaviour above. A filter that does not call it ignores `disabledServers` and `disabledTools`.

```typescript title="src/lib/mcp-session-filter.ts"
import { createMcpCapability, defaultMcpFilterTools } from "@flow-state-dev/tools/mcp";
import { linear } from "./mcp";

export const sessionMcpCap = createMcpCapability({
  servers: [linear],
  filterTools: async (ctx, tools) => {
    const sessionDisabled: string[] = ctx.session.state.mcpDisabledTools ?? [];
    const narrowed = await defaultMcpFilterTools(ctx, tools);
    return narrowed.filter((tool) => !sessionDisabled.includes(tool.name));
  },
});
```

`mcpDisabledTools` is a field of your own session state, so declare it on the generator's `sessionStateSchema`.

## Show which servers are connected

Build the manager yourself when a screen needs to list the connected servers, and hand it to the capability:

```typescript title="src/lib/mcp-manager.ts"
import { createMcpCapability, createMcpManager } from "@flow-state-dev/tools/mcp";
import { linear } from "./mcp";

export const manager = createMcpManager({ servers: [linear] });
export const managedMcpCap = createMcpCapability({ manager });
```

`manager.getCatalog()` returns each server's name, status (`pending`, `connected` or `errored`), error and tools, as plain data you can send to the client. It does not connect, so call `await manager.getTools()` first. The Tools reference has the manager's other methods.

Workforce coding runs take their MCP tools from a manager too. See [Workforce projects](../workforce/projects.md).

## Change it

`with` returns a copy of the capability with parts switched off. Pass the copy to `uses`.

```typescript title="src/lib/mcp-tools-only.ts"
import { mcpCap } from "./mcp";

export const toolsOnly = mcpCap.with({ guidance: false });
export const guidanceOnly = mcpCap.with({ tools: false });
```

`guidance: false` drops the system-prompt section and keeps the tools. `tools: false` keeps only the section, which is mostly useful for debugging a prompt.

## Next

- [Tools reference](../../reference/tools.md): every option, manager method and result shape.
- [Tools](./index.md): the other tools a generator can use.
