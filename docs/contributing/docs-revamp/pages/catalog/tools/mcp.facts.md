# Fact sheet: MCP tools (K-33, `catalog/tools/mcp`)

Sources cited: the exported surface and doc comments in `packages/tools/src/mcp/`, its tests
`packages/tools/test/mcp/`, one core test that observes what a generator's model receives
(`packages/core/test/generator-tools-fence.test.ts`), the existing user docs
(`apps/docs/docs/tools/mcp.md`, `apps/docs/docs/fundamentals/capabilities.md`,
`apps/docs/docs/advanced/capabilities-authoring.md`, `apps/docs/docs/workforce/projects.md`,
`packages/tools/README.md`), the revamp tools index
(`docs/contributing/docs-revamp/pages/catalog/tools/index.md`), and one example
(`apps/kitchen-sink/lib/mcp.ts`). No spec is cited. Paths are relative to the repo root. `M/` is
`packages/tools/src/mcp/`; `T/` is `packages/tools/test/mcp/`; `G/` is
`packages/core/test/generator-tools-fence.test.ts`.

Marks: **[page]** the page states it. **[ref]** Reference row, not prose. **[flag]** a conflict or a
gap the caller must settle before drafting.

## Stored data: the four questions

The MCP tools store nothing of their own. There is no resource, collection, state record or session
data. Owner, visibility, location and count do not apply.

What does exist, none of it stored by this package:

- The connection and the tool list live in memory in the manager, one entry per configured server.
  They are loaded once and cached; `close()` empties them. `M/manager.ts:296-305,415-424,513-524`.
- The server's headers (a key, usually) live in the config object you pass, in your process. The
  catalog's error text has header values taken out. `M/manager.ts:395-402`; `T/call-tool.test.ts:88-120`.
- The only request-scoped data is `ctx.request.state.mcp`, which the capability declares the shape
  of and reads. It is the caller's, one request long. `M/filter.ts:239-249`. See F26 on how it gets set.

## What it is

- F1. `createMcpCapability(options)` returns a capability named `mcp`. You attach it to a generator
  with `uses: [mcpCap]`. `M/capability.ts:49-61`; `T/capability.test.ts:8-12`; import from
  `@flow-state-dev/tools/mcp`, `M/index.ts:7`, `packages/tools/package.json:50-53`. **[page]**
- F2. Each tool a connected server publishes becomes a handler block named
  `mcp__<server>__<tool>`, with the server's own description and input schema.
  `M/manager.ts:323-359`; `T/manager.test.ts:48-66`. **[page]**
- F3. The model is told the tool's argument shape from the server's published JSON Schema. The
  server, not the framework, validates arguments. `M/manager.ts:320-322,347-352`. **[page]** (a
  clause)
- F4. A tool the server publishes without an `execute` returns `{ error: "Tool <tool> on server
  <server> does not support execution." }` to the model as the tool result, and the run continues.
  `M/manager.ts:335-342`; `T/manager.test.ts:133-148`. **[ref]**
- F5. The capability has two presets: `tools` (the tool list) and `guidance` (a system-prompt block).
  `default` turns on both. `M/capability.ts:64-76`; `T/capability.test.ts:14-19`. **[page]**
- F6. Preset use: `mcpCap.with({ guidance: false })` tools only; `mcpCap.with({ tools: false })`
  guidance only. `.with` is the capability builder in core: `packages/core/src/capability/define-capability.ts:168`;
  the keys are the preset names (`:102-115,168-200`). The existing page shows both lines.
  `apps/docs/docs/tools/mcp.md` "Presets". **[page]**
- F7. The package must have the optional peer `@ai-sdk/mcp` (`^2.0.7`) installed: `pnpm add
  @ai-sdk/mcp`. It is loaded on first connection, so an app that never configures MCP pays no
  install cost. `packages/tools/package.json:104-113`; `M/manager.ts:404-413`; README "Dependency",
  `packages/tools/README.md:430-432`. **[page]**
- F8. No key or setup comes from this package. A server's own key goes in `transport.headers`.
  `M/types.ts:15-19`; kitchen-sink `apps/kitchen-sink/lib/mcp.ts:25-29`. **[page]**

## Where the server is configured (sitemap question 3)

- F9. In the `servers` array passed to `createMcpCapability`, one object per server:
  `{ name, transport, description?, whenToUse?, examples?, category? }`. `M/types.ts:21-35`. **[page]**
- F10. `transport` is `{ type: "http" | "sse", url, headers? }`. `"http"` is Streamable HTTP and the
  recommended default; `"sse"` is still supported but most providers (Linear included) are moving
  off it. `M/types.ts:12-20`. **[page]**
- F11. `name` is the server's name in tool names (`mcp__linear__...`) and in `disabledServers`.
  `M/manager.ts:328,434`; `M/filter.ts:268`. **[page]** (no rule on allowed characters was found in
  the code for `createMcpCapability`; do not state one)
- F12. Instead of `servers` you can pass `manager` (from `createMcpManager({ servers })`); exactly
  one of the two. `M/types.ts:143-146` (`servers?: never` / `manager?: never`);
  `T/types.type-test.ts`. Use it when you need the catalog outside the capability. `M/capability.ts:52-55`. **[page]**
- F13. In the kitchen-sink app the server is read from `LINEAR_MCP_API_KEY` and the capability is
  `null` when the variable is unset; the flow then attaches it only when present with a dynamic
  `uses` entry. `apps/kitchen-sink/lib/mcp.ts:11-40`; `apps/kitchen-sink/flows/chat-agent/shared/capabilities/features.ts:174-175`.
  `apps/kitchen-sink/test/mcp.test.ts:22-36`. **[page]** (one sentence, as the example of the key
  living in an environment variable)
- F14. A Workforce project's coding runs configure MCP differently: `mcpServers` on the project,
  names only, with addresses and keys in the server config, and each user holding their own key. That
  is `apps/docs/docs/workforce/projects.md` "Tools a project's coding work gets" (heading at
  `:791`), not this capability. The manager is the one client under both: a coding run calls
  `manager.callTool(name, args, { signal })`. `M/manager.ts:271-280`; `M/types.ts:96-102`. **[page]**
  (one link; do not retell it)

## Why the tools may not reach the model: `uses` and `tools`

- F15. **[flag]** The sitemap's example reads "An MCP server in `tools`". The code does not support
  that wording. The MCP tools arrive through `uses: [mcpCap]`, not through a generator's `tools`
  list. The revamp index says the same: "Bash and MCP attach through `uses`".
  `docs/contributing/docs-revamp/pages/catalog/tools/index.md:23`; `M/capability.ts:64-71`;
  `apps/docs/docs/tools/mcp.md` "Configure a server". The page should show `uses`.
- F16. A generator that declares a `tools:` list at all, even `tools: []`, drops a capability's tools:
  the model gets only what that list names. A generator that declares no `tools:` receives the
  capability's tools. Tests observe the list the model receives. `G/:107-119,133-145,225-237`;
  implementation `packages/core/src/blocks/generator.ts:2974-3010`;
  `apps/docs/docs/fundamentals/capabilities.md:155-163`; `apps/docs/docs/advanced/capabilities-authoring.md:125`. **[page]**
- F17. To keep MCP tools on a generator that declares `tools:`, you name each tool in the list
  yourself; a tool the block names survives the fence. `G/:161-176`;
  `apps/docs/docs/fundamentals/capabilities.md:163`. The MCP capability does not export a handle for
  its tools, so the only way to name one is a tool object from `manager.getTools()` (a block named
  `mcp__<server>__<tool>`). `M/types.ts:93` (`getTools(): Promise<GeneratorTool[]>`). **[flag]** No
  test or example in the repo does this for MCP; if the page says it, mark it unverified or leave it
  out. The existing docs never mention it.
- F18. The guidance block is context, not a tool, so it reaches the model whether or not the
  generator declares `tools:`. `apps/docs/docs/fundamentals/capabilities.md:163` ("Context formatters
  ... arrive either way"); `M/capability.ts:72-74`. **[page]** (one clause)
- F19. `tools` presets are only valid on a generator. On a handler, sequencer or router the
  capability's `tools` preset throws: "tools is only valid on generator blocks". `packages/core/src/capability/merge.ts:572-578`;
  `packages/core/test/capability.test.ts:580-593`. **[ref]**

## What helps the model pick the right tool (sitemap question 2)

All per-server metadata is optional; a server with none still works. `M/types.ts:21-26`;
`apps/docs/docs/tools/mcp.md` "Metadata and selection quality".

- F20. Four metadata fields on each server, used in the system-prompt guidance block:
  `description` (shown in the block), `whenToUse` (rendered as `Use when: <text>`), `examples`
  (each rendered verbatim as a bullet under "Examples:"), `category` (groups servers under a
  `### <Category>` heading, hyphens become spaces and the first letter is capitalised).
  `M/context.ts:91-95,119-142,163-183`; `T/context.test.ts:36-84`. **[page]**
- F21. The existing page claims examples that look like real calls move selection quality "more than
  any other single change". **[flag]** No test, doc comment or goal measures this. Do not repeat it
  as a fact; say only that an example is shown to the model verbatim and name a call shape such as
  `mcp__linear__list_issues({ ... })`. `apps/docs/docs/tools/mcp.md` "Metadata and selection quality" (existing claim).
- F22. Servers without a `category` are grouped under "Other", listed last; categories appear in
  the order the servers were configured. `M/context.ts:89,157,170-174`; `T/context.test.ts:75-84`. **[ref]**
- F23. When no connected server has a `description`, `whenToUse` or `examples`, the block is a short
  generic one: `## MCP Tools`, "You have access to tools from these MCP servers: a, b.", and "Tool
  names are prefixed with the server name (e.g. mcp__a__tool_name)." In a mix, a bare server gets
  one fallback line, "Tools are prefixed with `mcp__<name>__`. Consult their descriptions to decide
  when to call." `M/context.ts:97-131,152-153`; `T/context.test.ts:11-23,86-end`. **[ref]**
- F24. Only connected servers appear in the guidance. A server that failed to connect, or has not
  connected yet, is left out, and the block is an empty string when none are connected.
  `M/context.ts:148-150`; `T/context.test.ts:6-10,24-34`. **[page]**
- F25. Every tool's description is prefixed with its server: `[linear] <description>`, by default.
  `enrichDescriptions: "category"` gives `[linear · project-management] <description>` for a server
  that has a `category` (and the plain prefix when it has none); `enrichDescriptions: false` leaves
  the server's text untouched. Enrichment never compounds across turns. `M/enrich.ts:203-213`;
  `M/capability.ts:23-47,57`; `T/capability.test.ts:29-40,90-122`; `T/enrich.test.ts:15-41`. **[page]**
- F26a. A custom guidance block: `formatGuidance: (catalog) => string` replaces the default. The
  catalog's servers carry `name`, `metadata`, `status`, `error?` and `tools`. `M/capability.ts:59,73`;
  `M/types.ts:56-67,111-114,139`; `T/capability.test.ts:80-88`. **[ref]**

## How you turn one tool off for a turn (sitemap question 1)

- F26. The capability declares `ctx.request.state.mcp` with two optional string arrays,
  `disabledTools` and `disabledServers`, merged into the flow's request state. When either array is set on the request's state, the default
  filter narrows the tool list for that request (see F30 on how it is set). `M/filter.ts:239-249,256-270`;
  `M/capability.ts:63`; `T/filter.test.ts:33-72`; `T/types.type-test.ts`. **[page]**
- F27. `disabledTools` takes the full namespaced name, `mcp__linear__list_issues`.
  `disabledServers` takes the server's `name`, and removes every tool from it. Both together apply
  as a union. `M/filter.ts:265-269`; `T/filter.test.ts:33-72`. **[page]**
- F28. The filter runs each time the tool list is built, so it does not reconnect: connections and
  the cached tool list are kept. The README says the same: "without reconnecting".
  `M/capability.ts:66-70`; `M/manager.ts:465-469`; `packages/tools/README.md:427`. **[page]**
- F29. A name in `disabledTools` or `disabledServers` that matches nothing is silently ignored, as
  is a tool without MCP provenance, which always passes. `M/filter.ts:251-254,265-269`;
  `T/filter.test.ts:51-58`. **[ref]**
- F30. **[flag]** How a caller supplies the `mcp` state is not shown in the code that was read. The
  existing page says "Request payload includes: { state: { mcp: { disabledServers: [...] } } }".
  I found no HTTP route, client method or test that copies a field of the caller's request body into
  `ctx.request.state`: the engine accepts `requestState` only as an execution option
  (`packages/engine/src/context/types.ts:110`, `createExecutionContext.ts:1757`), and the client's
  `state` fields are on session creation (`packages/client/src/client.ts:156`). The tests set it by
  building a context with `request: { state }` (`T/filter.test.ts:17-19`). The page can truthfully
  say a block writes `ctx.request.state.mcp` earlier in the same request, but even that has no MCP
  test. Settle before drafting; a safe fallback is F31, which is tested end to end only at the
  function level.
- F31. Custom policy: `filterTools: (ctx, tools) => GeneratorTool[] | Promise<GeneratorTool[]>`
  replaces the default filter. `defaultMcpFilterTools` is exported to compose over. The tool
  list handed to it already carries the enriched descriptions. `M/types.ts:104-107,134-137`;
  `M/index.ts:11`; `M/capability.ts:58,66-70`; `T/capability.test.ts:42-58`. **[page]**
- F32. `ctx` in `filterTools` is a full block context, so session state is readable
  (`ctx.session.state`). The existing page's session-persistence example uses a field `mcpDisabledTools`
  on the session state. That field is the app's own and not part of this package; the app must
  declare it. `packages/core/src/capability/types.ts:53-59`; `apps/docs/docs/tools/mcp.md`
  "Disabling tools at runtime". **[page]** (example only; type-check it before keeping it)
- F33. Replacing `filterTools` replaces the default too: a custom filter that does not call
  `defaultMcpFilterTools` no longer honors `disabledTools` or `disabledServers`.
  `M/capability.ts:58`. **[page]** (one sentence)

## Connection behavior and failure

- F34. Connection is lazy. Nothing connects at build time; the first time the tool list is needed
  (`getTools()`, or the `tools` preset) every configured server connects, in parallel, once.
  `M/manager.ts:426-462,465-469`; `T/manager.test.ts:19-33,99-111`. **[page]**
- F35. One server failing does not stop the others. The failed server is marked `errored`, a
  `console.warn` line `[mcp] Failed to connect to "<name>": <message>` is logged, and the other
  servers' tools load. `M/manager.ts:449-461`; `T/manager.test.ts:152-173`. **[page]**
- F36. The `errored` state shows in `manager.getCatalog()` with an `error` string. The error text
  has the server's header values removed (each value and each credential word after a leading scheme
  such as `Bearer`), so a key a client echoes never reaches the catalog or the log. `M/manager.ts:388-402,449-460`;
  `T/call-tool.test.ts:88-120`. **[page]**
- F37. A failed connection is not retried by the capability. The result is cached for the manager's
  life; `manager.close()` resets servers to `pending` so the next `getTools()` reconnects.
  `M/manager.ts:465-469,513-524`; `T/manager.test.ts:229-262`. **[page]** (section "When a server is down"; `close()` is reachable only on a manager the caller built)
- F38. Status values: `"pending"`, `"connected"`, `"errored"`. A catalog read before any connection
  returns every server as `pending`, with no tools. `M/types.ts:63`; `T/manager.test.ts:217-228`. **[ref]**

## The manager (the "expose the catalog" part)

- F39. `createMcpManager({ servers })` returns `{ getTools, getCatalog, getConnectedServerNames,
  getServerConfigs, callTool, close }`. `M/types.ts:90-118`. **[ref]**
- F40. `getCatalog()` returns `{ servers: [{ name, metadata, status, error?, tools }] }`, where each
  tool is `{ name, originalName, description, inputSchema, jsonSchema }`; `jsonSchema` is the plain
  JSON Schema as the server published it, `{ type: "object" }` when it published none. `M/types.ts:39-67`;
  `T/call-tool.test.ts:67-85`. **[ref]**
- F41. `getCatalog()` is synchronous and holds only what has connected so far; it does not connect.
  `M/manager.ts:471-485`. Call `getTools()` first for a full catalog. **[page]**
- F42. `getServerConfigs()` returns the configs with headers, which can hold a key; never log,
  record or emit what it returns. `M/types.ts:96-101`. **[ref]**
- F43. `callTool(name, args, { signal })` calls one tool by its namespaced name on its own server and
  returns what the server answered (an MCP `CallToolResult`, `isError` included). It connects first
  if needed. It throws `No connected MCP server has a tool named <name>.` for an unknown name or a
  server that failed to connect, throws if the call is already aborted, and passes the signal to the
  server's client. `M/types.ts:102-117`; `M/manager.ts:495-511`; `T/call-tool.test.ts:14-66`. **[ref]**
- F44. `redactSecrets(text, secrets)` is exported: it replaces each secret in the text with `…`,
  longest first, skipping empty ones. `M/manager.ts:372-386`; `M/index.ts:8`. **[ref]**
- F45. Other exports: `defaultMcpGuidanceFormatter`, `defaultMcpFilterTools`, `mcpRequestStateSchema`,
  `getMcpToolMeta`, `MCP_TOOL_META`, and the types `CreateMcpCapabilityOptions`,
  `CreateMcpManagerOptions`, `EnrichDescriptionsMode`, `FilterTools`, `MCPCallToolOptions`,
  `MCPCatalog`, `MCPCatalogServer`, `MCPCatalogTool`, `MCPClient`, `MCPManager`, `MCPServerConfig`,
  `MCPServerMetadata`, `MCPToolMeta`, `MCPTransportConfig`. `M/index.ts:7-28`. **[ref]**
- F46. `getMcpToolMeta(tool)` returns `{ mcp: { server, originalName } }` for a tool that came from
  an MCP manager and `null` for any other. A custom `filterTools` uses it to tell MCP tools from
  your own. `M/enrich.ts:215-223`; `T/enrich.test.ts:43-58`. **[ref]**
- F47. Using a manager yourself (`createMcpCapability({ manager })`) is the way to show users which
  servers are connected: send `manager.getCatalog()` to the client, it is serializable.
  `apps/docs/docs/tools/mcp.md` "Exposing the catalog"; `M/types.ts:36-67`. **[page]** (note: the
  catalog's `inputSchema` is the AI SDK wrapper, not plain JSON; send `jsonSchema` if you serialize
  the tools, `M/types.ts:44-50`)

## Limits (where a reader would assume otherwise)

- L1. Tool arguments are not validated by Flow State; the MCP server validates them. F3.
- L2. No retry, no reconnect on a dropped connection, no timeout option is exposed on the config.
  `M/types.ts:21-35` has no such field. **[page]** only if the page says "none" (the reader would
  assume otherwise); otherwise skip.
- L3. A generator that declares `tools:` loses the MCP tools unless it names them. F16.
- L4. The tools are for a generator. A coding run on a project is another route (F14).
- L5. `servers` and `manager` are exclusive. F12.
- L6. Server names are namespaced into tool names, so two servers can share a tool name without a
  clash. `M/manager.ts:328`; `T/manager.test.ts:48-66` (single-server) **[flag]** no two-server
  same-tool test was found; say only that names carry the server's name.
- L7. Resources and prompts: only a server's tools are used. The code reads `client.tools()` only.
  `M/manager.ts:428`; `M/types.ts:75-78`. **[page]** (one sentence; the reader may assume prompts and
  resources come through)

## Cross-page and neighbour notes

- N1. The tools index row: `createMcpCapability()` "Expose the tools of MCP servers", "Needs the
  optional `@ai-sdk/mcp` package". `docs/contributing/docs-revamp/pages/catalog/tools/index.md:21`.
- N2. `apps/docs/docs/tools/mcp.md` today claims the capability is wired with a "requestStateSchema
  ... narrows the tool list for that turn without touching connections" and that `tools` preset
  reaches generators. F16 qualifies the second one: the page must say a generator that declares
  `tools:` does not get them.
- N3. The existing page and the `packages/tools/README.md` MCP section carry the same configure
  example; the README needs no change from this page alone. `packages/tools/README.md:390-436`.
- N4. The Workforce page links to this page's manager for coding runs
  (`apps/docs/docs/tools/mcp.md` "Exposing the catalog" -> `../workforce/projects.md#tools-a-projects-coding-work-gets`).
  Keep that link when the draft replaces the page.

## Conflicts and unknowns the caller must settle

1. **Sitemap example says `tools`; the code says `uses`** (F15). Draft with `uses`.
2. **How a request sets `mcp.disabledServers`** (F30). Not observable in the surface read; the
   existing page's "Request payload includes" line is unverified. This is question 1 of the page and
   the answer needs a settled path (a block writing request state, or a custom `filterTools`).
3. **"Moves selection quality more than any other change"** (F21). No evidence; drop.
4. **Naming a tool to survive a declared `tools:` list** (F17). Allowed by the mechanism, no MCP
   example. Optional.
5. The existing page's example `ctx.session.state.mcpDisabledTools ?? []` is typed `any` through
   `CapabilityPresetCtx<any>` (`packages/core/src/capability/types.ts:53`); it compiles, but the
   field is the app's own and must be declared in the generator's session state for it to be real.

## Revise round 1 (what the page now states)

- F21: the example is now `mcp__linear__list_issues({ query: "login" })`; the selection-quality
  ranking is dropped. The page says only that an example is shown word for word.
- F30: the page says a request's state "can carry" `mcp.disabledServers` and `mcp.disabledTools`,
  and does not say how a caller sets it (no HTTP route found). Unchanged open question.
- F10: the SSE migration remark is cut; the page says use `"http"` unless the provider only offers SSE.
- F14: one link to `../workforce/projects.md` with no anchor (that page has no "Tools a project's
  coding work gets" heading). `callTool`'s signature is left to Reference R-42.
- F20, F22-F25, F26a, F29, F37-F46: moved to R-42 (`reference/tools`, `../../reference/tools.md`):
  metadata rendering and defaults, `enrichDescriptions`, `formatGuidance`, manager methods.
- Added: only tools are used, not prompts or resources (L7).

## Revise round 2

- F24, F35, F36, F37, L2: the page has a section "When a server is down" answering a docs-search outage at startup: the model gets the other servers' tools, one `[mcp] Failed to connect to "<name>": <message>` warning is logged, the guidance block lists only connected servers, `getCatalog()` shows `errored` with header values removed, no automatic retry, no retry or reconnect option, `manager.close()` then `getTools()` reconnects. The inline sentence in "Use it" is cut to the lazy, parallel connect.
