# @flow-state-dev/tools

Portable tool blocks for `@flow-state-dev` flows. Each tool is a handler block that can be passed directly to a generator's `tools` array.

## Search

Multi-provider web search with automatic provider detection.

```typescript
import { search } from "@flow-state-dev/tools/search";

const webSearch = search(); // auto-detects from env vars

generator({
  tools: [webSearch],
  // ...
});
```

### Providers

Provider is selected automatically based on available API keys (checked in order):

| Provider | Env var | Package | Result type |
|----------|---------|---------|-------------|
| Tavily | `TAVILY_API_KEY` | `@tavily/core` (optional peer dep) | Raw results |
| Exa | `EXA_API_KEY` | `exa-js` (optional peer dep) | Raw results |
| Perplexity | `PERPLEXITY_API_KEY` | _(fetch-based, no extra dep)_ | Raw results |
| Serper | `SERPER_API_KEY` | _(fetch-based, no extra dep)_ | Raw results |
| Brave | `BRAVE_SEARCH_API_KEY` | _(fetch-based, no extra dep)_ | Raw results |
| Perplexity Sonar | `PERPLEXITY_API_KEY` | _(fetch-based, no extra dep)_ | Grounded answer + citations |

Perplexity Search API returns raw ranked web results (hybrid lexical + semantic retrieval). Perplexity Sonar returns AI-synthesized answers with source citations, similar to Gemini grounding. When `PERPLEXITY_API_KEY` is set, auto-detection prefers the Search API. Use `perplexitySonarSearch()` to explicitly select the Sonar grounding provider.

### Configuration

```typescript
search({
  provider: "tavily",        // override auto-detection
  maxResults: 10,            // default: 5
  searchDepth: "advanced",   // "basic" (default) or "advanced"
  topic: "news",             // "general" (default) or "news"
  keys: { tavily: "sk-..." }, // explicit keys (default: env vars)
});
```

### Direct provider constructors

```typescript
import {
  tavilySearch,
  exaSearch,
  perplexitySearch,
  serperSearch,
  braveSearch,
  perplexitySonarSearch,
} from "@flow-state-dev/tools/search";
```

## Fetch

Fetch a single web page and return its content as clean, LLM-ready markdown.

```typescript
import { fetch } from "@flow-state-dev/tools/fetch";

const pageFetch = fetch(); // auto-detects from env vars

generator({
  tools: [pageFetch],
  // ...
});
```

### Providers

| Provider | Env var | Package |
|----------|---------|---------|
| Firecrawl | `FIRECRAWL_API_KEY` | `@mendable/firecrawl-js` (optional peer dep) |
| Jina Reader | `JINA_API_KEY` (optional) | _(fetch-based, no extra dep)_ |
| Built-in | _(none needed)_ | _(uses Readability + Turndown)_ |

Always works — falls back to built-in when no API keys are set.

### Direct provider constructors

```typescript
import { firecrawlFetch, jinaFetch, builtinFetch } from "@flow-state-dev/tools/fetch";
```

## Crawl

Crawl a website starting from a root URL, following links breadth-first.

```typescript
import { crawl } from "@flow-state-dev/tools/crawl";

const siteCrawl = crawl({ maxPages: 30, maxDepth: 2 });

generator({
  tools: [siteCrawl],
  // ...
});
```

### Providers

| Provider | Env var | Package |
|----------|---------|---------|
| Firecrawl | `FIRECRAWL_API_KEY` | `@mendable/firecrawl-js` (optional peer dep) |
| Built-in | _(none needed)_ | _(BFS crawler with Readability + Turndown)_ |

Always works — falls back to built-in BFS crawler when no API keys are set.

### Direct provider constructors

```typescript
import { firecrawlCrawl, builtinCrawl } from "@flow-state-dev/tools/crawl";
```

## Bash

Resource-backed bash execution with pluggable sandbox adapters. Files live as framework resources for persistence and portability. They're materialized into a real filesystem for execution, then synced back after mutations.

```typescript
import { createBashTool } from "@flow-state-dev/tools/bash";
import { providerTool } from "@flow-state-dev/core";

// Inside a handler's execute function:
const { tools, sandbox } = await createBashTool({
  collections: { files: ctx.resources.files },
  provider: { type: "local", cwd: "./workspace" },
});

// Pass to a generator as provider tools:
generator({
  providerTools: [
    providerTool("bash", tools.bash),
    providerTool("readFile", tools.readFile),
    providerTool("writeFile", tools.writeFile),
  ],
});
```

### Sandbox adapters

| Adapter | Provider type | Description |
|---------|--------------|-------------|
| Local FS | `"local"` | Real filesystem + `child_process`. Best for development. |
| Vercel | `"vercel"` | `@vercel/sandbox`. Supports persistent sandboxes. |
| Upstash | `"upstash"` | Placeholder — blocked on API stabilization (FIX-314). |
| just-bash | `"just-bash"` | In-memory bash emulation. No real processes. |
| MOAT | `"moat"` | Local container isolation with credential injection (requires the `moat` CLI v0.4.0+). |
| Custom | `"custom"` | Any object implementing the `Sandbox` interface. |

#### MOAT

Runs each command inside a MOAT-managed container on the same host as the agent. The host workspace is bind-mounted in; outbound network calls flow through a credential-injecting proxy so the agent process never sees API tokens.

**Install MOAT (one-time, host operator):**

The `moat` CLI is a separate binary — the framework spawns it but does not bundle or auto-install it. Install it from [majorcontext.com/moat](https://majorcontext.com/moat/) and verify the version is at least `0.4.0` (required for `moat exec`):

```bash
moat version --json
```

Prerequisites the host needs:

- macOS 15+ on Apple Silicon (native containers) **or** any Linux host with Docker installed.
- One `moat grant <provider>` per credential the agent should be able to reach (`moat grant github`, `moat grant openai`, etc.). The framework only declares which grant names a workspace requires — it never stores the credentials itself. See the [credentials concept page](https://majorcontext.com/moat/concepts/credentials).

Use:

```typescript
import { createBashCapability } from "@flow-state-dev/tools/bash";

const bashCap = createBashCapability({
  provider: {
    type: "moat",
    grants: ["github"],
    allowHosts: ["api.github.com"],
  },
});
```

Wiring cleanup is **required** for the MOAT provider — without it, every flow request leaves a container behind. The capability returns a `cleanupBlock` for this:

```typescript
defineFlow({
  // ...
  request: { onFinished: bashCap.cleanupBlock },
});
```

The cleanup block is returned for every provider so the capability shape stays stable; for non-MOAT providers it is effectively a no-op.

**Persistent containers for local dev.** MOAT cold-start takes a few seconds. For local development, set a stable `runName` and `persist: true` to reuse one container across requests — the cleanup block becomes a no-op, the next request reconnects via `moat list --json`, and operators reclaim resources with `moat stop <runName>` or `moat clean`:

```typescript
createBashCapability({
  provider: {
    type: "moat",
    runName: "fsdev-dev",
    persist: true,
    grants: ["github"],
    allowHosts: ["api.github.com"],
  },
});
```

See the [bash docs page](https://flow-state-dev.com/docs/tools/bash#moat-local-container-isolation) for grants, network policy, and limits.

### Configuration

```typescript
createBashTool({
  collections: { files: ctx.resources.files },
  provider: { type: "vercel" },
  destination: "/workspace",     // workspace root (default: "/workspace")
  persist: true,                 // persist sandbox across sessions
  syncMode: "diff",              // "diff" (default) or "full"
  fileFilter: (p) => !p.includes("node_modules"),
  onBeforeCommand: (cmd) => {
    if (cmd.includes("rm -rf /")) return "echo 'Nice try.'";
  },
});
```

### Sync lifecycle

1. **Hydrate** — resource collection entries are written into the sandbox filesystem
2. **Execute** — `bash`, `readFile`, `writeFile` tools are available to the LLM
3. **Flush** — after every `bash` and `writeFile`, changed files sync back to resources
4. Deleted files are removed from resource collections. `readFile` does not trigger a flush.

### Workspace path restrictions (Local FS)

The local adapter validates commands and file paths against the workspace root before execution. This is enabled by default (`strictPaths: true`). It is a best-effort defense for cooperative agents, not a security boundary.

**What the guard checks.** Before tokenizing, the raw command is screened for shell constructs whose presence is itself the violation: home references (`~/`), `$HOME`, command substitution (`$()`, backticks), process substitution (`<(...)`, `>(...)`), and path traversals (`../`). The command is then split into tokens (the same way bash splits words) and each path-shaped token is checked: tokens that resolve outside the workspace root and outside the safe-system allowlist (e.g. `/dev/null`) are rejected. `readFile` and `writeFile` resolve their argument against the workspace root and reject anything that escapes it.

**What the guard does not check.** Content inside quoted strings, heredoc bodies, and similar opaque arguments is treated as data, not as candidate paths. `python3 -c "x = 1 / 2"` is allowed because the inner script is a quoted argument. `cat << EOF\n/etc/passwd\nEOF` is allowed because the body of a heredoc is data, not a filesystem reference. The trade-off is deliberate: scanning quoted content produced unacceptable false positives in inline-code use cases, and one consequence is that a literal absolute path inside either single or double quotes (`cat "/etc/passwd"`, `cat '/etc/passwd'`) is no longer rejected — the unquoted form (`cat /etc/passwd`) still is.

```typescript
// Default: strictPaths is true
provider: { type: "local", cwd: "./workspace" }

// Allowed (inline code with arithmetic):
//   python3 -c "x = 1 / 2"
// Rejected (unquoted absolute path outside workspace):
//   cat /etc/passwd

// Opt out for power users (logs a warning):
provider: { type: "local", cwd: "./workspace", strictPaths: false }
```

When a command is rejected, the error message names the specific offending token so the agent can self-correct. For true isolation, use the `just-bash` adapter (in-memory emulation) or wait for OS-level sandboxing in a future release.

### Direct adapter constructors

```typescript
import {
  createLocalFsSandbox,
  createVercelAdapter,
  createJustBashSandbox,
} from "@flow-state-dev/tools/bash";
```

## MCP (Model Context Protocol)

Connect external MCP servers and expose their tools to generators as framework handler blocks, with selection guidance, tool-description enrichment, and a request-state filter.

```typescript
import { createMcpCapability } from "@flow-state-dev/tools/mcp";

const mcpCap = createMcpCapability({
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
        type: "http",
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: `Bearer ${process.env.LINEAR_MCP_API_KEY}` },
      },
    },
  ],
});

generator({
  uses: [mcpCap],
  // ...
});
```

### Features

- **Namespaced tools.** Each MCP tool becomes a handler block named `mcp__<server>__<tool>`.
- **Selection guidance.** A markdown system-prompt block is generated from per-server metadata (`description`, `whenToUse`, `examples`), grouped by `category`.
- **Description enrichment.** Tool descriptions are prefixed with `[server]` (or `[server · category]`) so attribution reads as natural language during tool selection.
- **Request-state filter.** The capability contributes a `requestStateSchema`. Flows can set `ctx.request.state.mcp.disabledTools` or `disabledServers` to narrow tools per turn without reconnecting.
- **Error isolation.** A failed server does not block healthy ones.

### Dependency

`@ai-sdk/mcp` is an optional peer dependency and is loaded dynamically the first time a tool is requested. Apps that don't configure MCP pay no install or bundle cost.

### Escape hatch

Use `createMcpManager({ servers })` when you need the raw client outside a capability (custom wiring, calling `getCatalog()` directly, etc.), then pass it to `createMcpCapability({ manager })`.

## Provider-native search

For provider-level search tools (grounded responses, citations), use the `search` field on generator config instead:

```typescript
generator({
  search: true, // uses the model provider's native search tool
});
```

See `@flow-state-dev/core` generator docs for details.
