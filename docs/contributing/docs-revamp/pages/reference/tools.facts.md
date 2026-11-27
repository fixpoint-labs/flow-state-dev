# Facts for Tools (R-42, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests and `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. Where a fact comes from reading implementation rather than a test or an exported doc comment it is marked **[source]**; **[test]** where a test pins it; **[ran]** where I ran it this session (a throwaway vitest file in `packages/tools/test`, deleted afterwards; nothing left in the tree); **[doc]** where only an existing user page states it and the code neither confirms nor contradicts it. Nothing was run against a live provider, a real `moat` binary, Vercel or GitHub.

Abbreviations (paths from the repo root):

- `T` = `packages/tools/src`; `TT` = `packages/tools/test`; `W` = `packages/workspace/src`; `WT` = `packages/workspace/test`; `C` = `packages/core/src`.
- Search: `S` = `T/search/index.ts`, `St` = `T/search/types.ts`, `Sr` = `T/search/resolver.ts`, providers in `T/search/providers/<name>.ts`, `Sd` = `T/search/providers/domain-filters.ts`.
- Fetch: `F` = `T/fetch/index.ts`, `Ft` = `T/fetch/types.ts`, `Fr` = `T/fetch/resolver.ts`, `Fe` = `T/fetch/errors.ts`, providers in `T/fetch/providers/<name>.ts`, `Fv` = `T/_internal/fetch-validated.ts`, `Pu` = `T/_internal/public-url.ts`, `H2M` = `T/_internal/html-to-markdown.ts`.
- Crawl: `K` = `T/crawl/index.ts`, `Kt` = `T/crawl/types.ts`, `Kr` = `T/crawl/resolver.ts`, `Kb` = `T/crawl/providers/builtin.ts`, `Kf` = `T/crawl/providers/firecrawl.ts`.
- Bash: `Bt` = `T/bash/types.ts`, `Bc` = `T/bash/capability.ts`, `Bb` = `T/bash/blocks.ts`, `Bk` = `T/bash/create-bash-tool.ts`, `Br` = `T/bash/resolve-sandbox.ts`, `Bp` = `T/bash/projection-setup.ts`, `Bs` = `T/bash/sandbox-place.ts`, `Bi` = `T/bash/index.ts`. Adapters in `T/bash/adapters/`: `lf` = `local-fs.ts`, `jb` = `just-bash.ts`, `up` = `upstash.ts`, `vc` = `vercel.ts`, `mo` = `moat.ts`, `wg` = `workspace-guards.ts`.
- MCP: `M` = `T/mcp/` (`types.ts`, `capability.ts`, `context.ts`, `enrich.ts`, `filter.ts`, `manager.ts`, `index.ts`).
- Workspace package: `pj` = `W/projection.ts`, `wt` = `W/types.ts`, `rt` = `W/routing.ts`, `cl` = `W/claims.ts`, `si` = `W/scope-identity.ts`, `hp` = `W/host-place.ts`, `mp` = `W/memory-place.ts`, `bp` = `W/branch-pull-requests.ts`. Core: `pr` = `C/types/pull-requests.ts`.
- Package: `pkg` = `packages/tools/package.json`; `readme` = `packages/tools/README.md`.
- Existing pages: `p-over` = `apps/docs/docs/tools/overview.md`, `p-search`, `p-fetch`, `p-crawl`, `p-bash`, `p-mcp`, `p-ws` = `apps/docs/docs/tools/{search,fetch,crawl,bash,mcp,workspace}.md`.
- Tests: `tsearch` = `TT/search.test.ts`, `tres` = `TT/resolver.test.ts`, `tfetch` = `TT/fetch/{fetch,errors,resolver}.test.ts` and `TT/fetch/providers/*.test.ts`, `tcrawl` = `TT/crawl/**`, `tbash` = `TT/bash.test.ts`, `tscope` = `TT/bash-workspace-scope.test.ts`, `trel` = `TT/bash-sandbox-release.test.ts`, `tlim` = `TT/bash-local-fs-limits.test.ts`, `tmoat` = `TT/bash-moat*.test.ts`, `tmcp` = `TT/mcp/*.test.ts`, `tpj` = `WT/projection.spec.ts`, `tcc` = `WT/concurrency.spec.ts`, `thp` = `WT/host-place.spec.ts`, `tbp` = `WT/branch-pull-requests.spec.ts`.

## What the page is

A Reference page for `@flow-state-dev/tools` and the two surfaces it leans on (`@flow-state-dev/workspace`, the file projection under Bash; core's pull-request rows). Tables and signatures, no narrative. Lookups it answers by name: "Which search providers are supported?" (seven: Table S-1), "Which provider is used when you name none?" (S-4, F-3, K-3), "What does a failed fetch throw?" (F-6).

Imports the page's rows name:

- Root `@flow-state-dev/tools`: `tools` (`{ search, fetch, crawl, createBashTool }`, `T/index.ts:6`), `search`, `tavilySearch`, `exaSearch`, `perplexitySearch`, `serperSearch`, `braveSearch`, `parallelSearch`, `perplexitySonarSearch`, `fetch`, `firecrawlFetch`, `jinaFetch`, `builtinFetch`, `crawl`, `firecrawlCrawl`, `builtinCrawl`, `createBashTool`, the schemas `searchInputSchema`/`searchOutputSchema`/`searchResultSchema`/`searchProviders`, `fetchInputSchema`/`fetchResultSchema`/`fetchProviders`, `crawlInputSchema`/`crawlResultSchema`/`crawlProviders`, and the types `SearchConfig`, `SearchResult`, `SearchOutput`, `SearchProviderName`, `SearchInput`, `FetchConfig`, `FetchResult`, `FetchProviderName`, `FetchInput`, `CrawlConfig`, `CrawlResult`, `CrawlProviderName`, `CrawlInput`, `Sandbox`, `CommandResult`, `SandboxProvider`, `BashSessionState`, `CreateBashToolOptions`, `CreateBashToolResult`, `BashToolkit` (`T/index.ts:6-71`).
- `@flow-state-dev/tools/search` additionally exports `searchTiers`, `SearchTier`, `SearchCapabilities`, `SearchProviderAdapter` and `resolveProvider` (`S:90-106`). `@flow-state-dev/tools/fetch` and `/crawl` additionally export their adapter types (`F:49-57`, `K:49-57`).
- `@flow-state-dev/tools/bash`: `createBashTool`, `createBashCapability`, `createBashBlocks`, `releaseBashSandbox`, `createSandboxPlace`, `createLocalFsSandbox`, `hashContent`, and the types `Sandbox`, `CommandResult`, `SandboxProvider`, `WorkspaceScope`, `NetworkConfig`, `ExecutionLimits`, `BashSessionState`, `CreateBashToolOptions`, `CreateBashToolResult`, `BashToolkit`, `CreateBashBlocksOptions`, `BashCollectionSpec`, `CreateBashCapabilityOptions`, `UpstashBoxClient` (`Bi:23-53`). The root re-exports only `createBashTool` and a subset of the types. The just-bash, Vercel, Upstash and MOAT adapters and the MOAT error classes are **not** exported (`Bi:31-35`).
- `@flow-state-dev/tools/mcp`: `createMcpCapability`, `createMcpManager`, `redactSecrets`, `defaultMcpGuidanceFormatter`, `defaultMcpFilterTools`, `mcpRequestStateSchema`, `getMcpToolMeta`, `MCP_TOOL_META`, and the types in `M/index.ts:13-28`.
- `@flow-state-dev/workspace`: `createProjection`, `hashContent`, `createMemoryPlace`, `createHostPlace`, `PlaceUnreadableError`, `claimKey`, `createClaimRegistry`, `sharedClaimRegistry`, `collectionIdFor`, `principalFromContext`, `scopeComponents`, `frameComponents`, `unscopedCollectionId`, `recordBranchPullRequests`, `BRANCH_PULL_REQUESTS_TIMEOUT_MS`, and the types `Place`, `Mount`, `FlushOutcome`, `FlushReport`, `ProjectedEntryExtra`, `ProjectedEntryState`, `BranchPullRequestsResult` (`W/index.ts:21-74`). The package also exports a workspace host, worktree list, land and source-read surface that is **not** part of the rows routed here (see "Rows not carried").
- Package facts: `@flow-state-dev/tools` 0.2.2 (`pkg:3`); Node `>=22` (`pkg:92`); subpath exports `.`, `./search`, `./fetch`, `./crawl`, `./bash`, `./mcp` (`pkg:29-62`); runtime dependencies `@flow-state-dev/core`, `@flow-state-dev/workspace`, `@mozilla/readability`, `ai`, `linkedom`, `shell-quote`, `turndown`, `zod` (`pkg:95-103`).

## Table T-1: The four tools and when each is available

| Tool | Built with | Name the model sees | Works with no keys? | Cite |
| --- | --- | --- | --- | --- |
| `tools.search()` | `handler` | `search` | No. With no key it throws at execution time (`No search provider available...`), not at construction | `S:38-58`, `Sr:64-68`, `tsearch` |
| `tools.fetch()` | `handler` | `fetch` | Yes: the built-in provider is always chosen when no key is set | `F:19-33`, `Fr:43-44` |
| `tools.crawl()` | `handler` | `crawl` | Yes: the built-in crawler | `K:19-37`, `Kr:36-37` |
| `createBashTool()` | AI SDK `tool()` objects, not blocks | `bash`, `readFile`, `writeFile` | Defaults to the `just-bash` provider. That needs the optional `just-bash` peer dependency; without it the sandbox is an in-memory map that runs **no commands** (every command except `find ...` returns exit code 1 with `In-memory sandbox: install just-bash for full bash support`) | `Bk:157-216`, `jb:39-128` |
| `createBashCapability()` | `defineCapability` with three blocks: handlers, or sequencers around a handler (all three for `vercel`, `upstash`; for `moat` only `bash` and `bash-read-file`, since `bash-write-file` is the host-fs handler) (`Bb:1045-1095`; the names the model sees do not change) | `bash`, `bash-read-file`, `bash-write-file` | Same default provider, same fallback | `Bc:215-267`, `Bb:922-1095` |

The model-facing descriptions: search "Search the web for information. Returns titles, URLs, and snippets from web pages matching the query." (`S:40-41`); fetch "Fetch a web page and return its content as markdown. Use this to read the full content of a URL found via search or provided by the user." (`F:21-23`); crawl "Crawl a website starting from a root URL, following links up to a specified depth. Returns markdown content for each page. Use this for site-wide content ingestion." (`K:21-23`, abridged). The tool objects are built once and read the environment at call time: `detectApiKey` reads `process.env[var]` on every call (`T/_internal/env.ts:1-3`), so a key set after construction is picked up.

Optional peer dependencies (all marked optional in `pkg:105-124`): `@ai-sdk/mcp ^2.0.7` (MCP), `@mendable/firecrawl-js ^1.15.0` (Firecrawl fetch and crawl), `@tavily/core ^0.7.0` (Tavily), `exa-js ^1.5.0` (Exa), `just-bash ^2.14.0` (the `just-bash` sandbox). Perplexity, Serper, Brave, Parallel, Perplexity Sonar, Jina and the built-in fetch and crawl need none. A missing SDK throws a plain `Error` at call time naming the package: `Install @tavily/core to use the Tavily search provider: npm install @tavily/core` (`T/search/providers/tavily.ts:19-23`), the same shape for `exa-js` (`exa.ts:24-28`), and `Install @mendable/firecrawl-js to use the Firecrawl fetch provider: npm install @mendable/firecrawl-js` / `...Firecrawl crawl provider...` (`T/fetch/providers/firecrawl.ts:11-14`, `Kf:10-13`). `just-bash` and `@ai-sdk/mcp` failures differ: see B-3 and MCP-1.

Key variables (one table on the page; `Sr:19-27`, `Fr:9-12`, `Kr:9-11`):

| Variable | Serves |
| --- | --- |
| `TAVILY_API_KEY` | search: Tavily |
| `EXA_API_KEY` | search: Exa |
| `PERPLEXITY_API_KEY` | search: Perplexity **and** Perplexity Sonar (one key, two providers) |
| `SERPER_API_KEY` | search: Serper |
| `BRAVE_SEARCH_API_KEY` | search: Brave |
| `PARALLEL_API_KEY` | search: Parallel |
| `FIRECRAWL_API_KEY` | fetch and crawl: Firecrawl |
| `JINA_API_KEY` | fetch: Jina. Optional. Jina is auto-selected only when this is set; without it Jina is used only when forced (`jinaFetch()` / `provider: "jina"`) |

`config.keys` beats the environment for every provider (`Sr:314`, `Fr:51-57`, `Kr:44-45`). `keys` is `Partial<Record<SearchProviderName, string>>` for search (so the Sonar entry is `keys["perplexity-sonar"]`), `{ firecrawl?, jina? }` for fetch, `{ firecrawl? }` for crawl (`St:96`, `Ft:42-45`, `Kt:53-55`).

## Table S: `tools.search`

### S-1: Providers (answers "Which search providers are supported?")

Seven. `searchProviders` = `["tavily","exa","perplexity","serper","brave","parallel","perplexity-sonar"]` (`St:5`).

| Provider | Name | Constructor | Env var | Package needed | Auto-select rank | Tiers it serves | Cite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Parallel | `parallel` | `parallelSearch` | `PARALLEL_API_KEY` | none | 1 | fast, balanced, deep | `parallel.ts:25-27`, `Sr:9-17` |
| Tavily | `tavily` | `tavilySearch` | `TAVILY_API_KEY` | `@tavily/core` | 2 | all | `tavily.ts:13` |
| Exa | `exa` | `exaSearch` | `EXA_API_KEY` | `exa-js` | 3 | all | `exa.ts:21` |
| Perplexity | `perplexity` | `perplexitySearch` | `PERPLEXITY_API_KEY` | none | 4 | all | `perplexity.ts:22` |
| Serper | `serper` | `serperSearch` | `SERPER_API_KEY` | none | 5 | fast, balanced | `serper.ts:15` |
| Brave | `brave` | `braveSearch` | `BRAVE_SEARCH_API_KEY` | none | 6 | fast, balanced | `brave.ts:15` |
| Perplexity Sonar | `perplexity-sonar` | `perplexitySonarSearch` | `PERPLEXITY_API_KEY` | none | 7 | all | `perplexity-sonar.ts:22` |

- Because Perplexity (rank 4) and Perplexity Sonar (rank 7) share one key, and Perplexity serves all three tiers, auto-selection **never** picks Sonar. Sonar is reachable only by `provider: "perplexity-sonar"` or `perplexitySonarSearch()`. **[source]**, derived from `Sr:9-17`, `Sr:19-27`, `perplexity.ts:22`, `perplexity-sonar.ts:22`.
- The constructor of each is `search({ ...config, provider })`; config is `SearchConfig` minus `provider` (`S:62-88`).
- Providers with no package use `fetch` over HTTP; endpoints, for the optional "How it calls" column (implementation, likely cut): Perplexity `POST https://api.perplexity.ai/search` Bearer (`perplexity.ts:27-35`); Serper `POST https://google.serper.dev/search` or `/news` with `X-API-KEY` (`serper.ts:17-31`); Brave `GET https://api.search.brave.com/res/v1/web/search` with `X-Subscription-Token` (`brave.ts:23-29`); Parallel `POST https://api.parallel.ai/v1/search` with `x-api-key` (`parallel.ts:17`, `39-44`); Sonar `POST https://api.perplexity.ai/chat/completions` Bearer (`perplexity-sonar.ts:30-36`).

### S-2: Config options (`SearchConfig`, `St:60-96`) and the tool's call parameters

| Option | Type | Default | Set by | Effect | Cite |
| --- | --- | --- | --- | --- | --- |
| `provider` | one of the seven names | absent: auto-select | config | Forces a provider. Throws if its key is missing | `St:62`, `Sr:32-42` |
| `tier` | `fast` \| `balanced` \| `deep` | `balanced` | config; also the model when `agentControlsTier` | Retrieval thoroughness. Mapping in S-3 | `St:81-87`, `S:24`, `S:45` |
| `agentControlsTier` | boolean | `false` | config | `true` adds a `tier` parameter to the tool's input schema (enum `fast`/`balanced`/`deep`, default = the config `tier`, with a description telling the model when to use `deep`). The config `tier` is then only the default the model may override | `St:88-93`, `S:27-36`, `S:45` |
| `searchDepth` | `basic` \| `advanced` | `basic` | config | How much content a provider pulls per result. Not the same as `tier`. See S-3 | `St:66`, `S:49` |
| `searchMode` | string | absent | config | Provider-native mode, passed through; beats the `tier` mapping where a provider reads it (Exa `type`, Parallel `mode`, Sonar model name). Others ignore it | `St:67-75`, `exa.ts:35`, `parallel.ts:30`, `perplexity-sonar.ts:25-27` |
| `includeDomains` | `string[]` | none | config | Restrict results. See S-5 | `St:94`, `S:52` |
| `excludeDomains` | `string[]` | none | config | Exclude domains. See S-5 | `St:96` |
| `keys` | `Partial<Record<SearchProviderName,string>>` | env | config | Explicit keys; beat the environment | `St:100` |
| `maxResults` | number | — | **no effect in config** | Declared on `SearchConfig` ("Default: 5") but `search()` never reads it. The result count is the tool's call parameter `maxResults` (default 5). **[ran]**: `search({ provider:"serper", maxResults: 2 })` called with `{ query }` sent `num: 5` | `St:64`, `S:44-57`, `[ran]` |
| `topic` | `general` \| `news` | — | **no effect in config** | Declared on `SearchConfig` but never read from config. `topic` is a call parameter (default `general`). **[ran]**: `search({ topic:"news" })` hit `https://google.serper.dev/search`, not `/news` | `St:98`, `S:54`, `[ran]` |

Tool call parameters (what the model supplies, `searchInputSchema`, `St:44-54`): `query` (string, required), `maxResults` (number, default 5), `topic` (`general` \| `news`, default `general`), plus `tier` only when `agentControlsTier` is on.

`topic` is honoured by: Tavily (`topic` forwarded, `tavily.ts:34`) and Serper (`news` endpoint, `serper.ts:17-20`). It is ignored by Exa, Perplexity, Brave, Parallel (`parallel.ts:37-38`, "intentionally not forwarded") and Sonar. **[source]** (each adapter's request body).

### S-3: `tier` and `searchDepth` per provider

`tier` default `balanced`; it is a "deliberately small, lossy vocabulary" (`St:9-16`). `balanced` is supported by every provider, so the default never changes selection (`St:104-108` doc, `Sr:286-292`).

| Provider | `fast` | `balanced` | `deep` | Cite |
| --- | --- | --- | --- | --- |
| Exa | `type: "fast"` | `type: "auto"` | `type: "deep"` | `exa.ts:13-17` |
| Tavily | `searchDepth: basic` | `basic` | `advanced` | `tavily.ts:27-30` |
| Perplexity | `search_context_size: low` | field omitted (provider default) | `search_context_size: high` | `perplexity.ts:22-24`, `35` |
| Perplexity Sonar | model `sonar` | `sonar` | `sonar-reasoning` | `perplexity-sonar.ts:25-27` |
| Parallel | `mode: basic` | `mode: advanced` | `mode: advanced` | `parallel.ts:19-23` |
| Serper | ignored | ignored | ignored | `serper.ts:3-7` |
| Brave | ignored | ignored | ignored | `brave.ts:3-7` |

`searchDepth` (separate from `tier`): Tavily uses `advanced` if **either** `tier` is `deep` or `searchDepth` is `advanced` (`tavily.ts:27-30`). Exa: `advanced` requests full text and fills `content`; `basic` caps text at 500 characters and leaves `content` unset; the snippet is the first highlight, else the first 300 characters of text (`exa.ts:39-42`, `58-61`, `55`). Parallel: `max_chars_per_result` is 6000 for `advanced`, 1500 otherwise (`parallel.ts:51-55`). Perplexity, Serper, Brave and Sonar ignore it.

The page's "tier idea" sentence and one `tier: "deep"` example are on the existing page (`p-search:179-190`); the 7-row table is the row.

### S-4: Provider auto-selection (answers "Which provider is used when you name none?")

1. `provider` set: that provider; no key → throws `Search provider "<name>" requested but no API key found. Set <VAR> or pass it via config.keys.<name>` (`Sr:32-42`).
2. Otherwise walk priority Parallel, Tavily, Exa, Perplexity, Serper, Brave, Perplexity Sonar; take the first with a key **whose supported tiers include the requested tier** (`Sr:44-53`). So `tier: "deep"` skips Serper and Brave even with a key.
3. If no keyed provider supports the tier, take the first keyed provider in priority order (it "clamps/ignores the tier") (`Sr:55-62`).
4. No key at all: throws `No search provider available. Configure at least one of: PARALLEL_API_KEY, TAVILY_API_KEY, EXA_API_KEY, PERPLEXITY_API_KEY, SERPER_API_KEY, BRAVE_SEARCH_API_KEY, PERPLEXITY_API_KEY — or pass keys explicitly via search({ keys: { tavily: '...' } })` (`Sr:64-68`; note `PERPLEXITY_API_KEY` is listed twice, once for Sonar). Thrown when the tool executes, not when it is built. **[test]** `tres`, `tsearch`.
5. The decision is made on every call, with the call's `tier` (`S:45-46`).

### S-5: Domain filters

`includeDomains`/`excludeDomains`. "Every provider applies them" (`p-search:224`; code: every adapter reads both).

| Provider | How | Cite |
| --- | --- | --- |
| Tavily | native `includeDomains` / `excludeDomains` fields, sent only when non-empty | `tavily.ts:36-41` |
| Exa | native `includeDomains` / `excludeDomains`, only when non-empty | `exa.ts:43-48` |
| Parallel | `source_policy.include_domains` / `exclude_domains`, only when set | `parallel.ts:31-35` |
| Perplexity, Perplexity Sonar | `search_domain_filter`: an allowlist **or** a denylist. With any include domain, only the include list is sent and excludes are dropped (so an excluded subdomain of an included domain can still appear). With only excludes, each is sent `-`prefixed | `Sd:36-42`, `perplexity.ts:25`, `perplexity-sonar.ts:28` |
| Serper, Brave | written into the query as `site:` and `-site:` operators. Several includes are OR-grouped `(site:a OR site:b)`; excludes are AND-chained | `Sd:12-27`, `serper.ts:25`, `brave.ts:18` |

### S-6: Output (`searchOutputSchema`, `St:22-38`)

`{ query: string, results: SearchResult[], answer?: string }`. `SearchResult` = `{ title, url, snippet, content?, score?, publishedDate?, source }`, `source` one of the seven provider names.

| Field | Set by | Cite |
| --- | --- | --- |
| `content` | Exa only at `searchDepth: "advanced"`; Parallel when a result has more than one excerpt (excerpts joined with a blank line). No other provider sets it | `exa.ts:58-61`, `parallel.ts:89-92` |
| `score` | Exa, Tavily, when the provider returns one | `exa.ts:62`, `tavily.ts:46` |
| `publishedDate` | Tavily, Exa, Perplexity (`date` else `last_updated`), Serper (`date`), Parallel (`publish_date`). Not Brave, not Sonar | per adapter |
| `answer` | Tavily (always requested, `includeAnswer: true`); Serper (`answerBox.answer`, else `answerBox.snippet`); Sonar (the model's reply text) | `tavily.ts:35`, `serper.ts:54`, `perplexity-sonar.ts:54`, `65` |
| Sonar results | one result per citation URL with `title: ""` and `snippet: ""` | `perplexity-sonar.ts:59-64` |

The existing page lists `answer` as from "grounding providers like Sonar" only (`p-search:267`); Tavily and Serper also return it. Results are cut to `maxResults` after the provider answers (all adapters `slice(0, maxResults)` except Tavily and Exa, which pass the limit to the API).

### S-7: Errors

All plain `Error`s (not `FlowError`; no `details`, no `retryable`). A non-2xx from a provider throws `<Provider> API error: <status> <statusText>`: `Perplexity Search API error:`, `Serper API error:`, `Brave Search API error:`, `Perplexity Sonar API error:` (`perplexity.ts:47-49`, `serper.ts:36-39`, `brave.ts:33-36`, `perplexity-sonar.ts:47-50`); Parallel appends ` — <response body>` (`parallel.ts:63-69`). Key and SDK errors: S-4 and T-1. **[source]**; the provider adapters are exercised in `TT/providers/*.test.ts`.

### S-8: The generator's own `search` field is a different system

`generator({ search: ... })` turns on the model provider's built-in web search (inside the provider); `tools.search` calls a third-party API. They share no configuration: `tier` is `tools.search`-only. `searchDepth` is `basic` \| `advanced` on `tools.search` and `low` \| `medium` \| `high` on the generator, where it maps to OpenAI's `searchContextSize` (`C/types/model.ts:30-31`, `C/models/createAiSdkModelResolver.ts:751`; `p-search:293-306`). The generator's own fields (`maxUses`, `allowedDomains`, `blockedDomains`, `userLocation`, `searchDepth`; `C/types/model.ts:15-32`) belong to the generator reference, not this page.

## Table F: `tools.fetch`

### F-1: Config (`FetchConfig`, `Ft:36-46`)

| Option | Type | Default | Effect | Cite |
| --- | --- | --- | --- | --- |
| `provider` | `firecrawl` \| `jina` \| `builtin` | absent: auto | Force a provider | `Ft:38`, `Fr:18-30` |
| `waitForJS` | boolean | `false` | Takes effect **for Firecrawl only**, which then waits 5000 ms (`waitFor: 5000`). Jina and built-in never read it. The type's doc comment ("Firecrawl, Jina") and `p-fetch:46` ("Firecrawl and Jina only") say Jina; code says no | `Ft:39-40`, `F:29`, `firecrawl.ts:20`, `jina.ts:6-49` |
| `keys.firecrawl`, `keys.jina` | string | env | Beat `FIRECRAWL_API_KEY` / `JINA_API_KEY` | `Fr:51-57` |

The tool's call parameter is only `url` (string) (`Ft:28-30`). No limits, timeouts or headers are configurable.

### F-2: Providers

| Provider | Name | Constructor | Key | Package | How it fetches | `url` it reports | `contentType` | `statusCode` | `description` | Cite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Firecrawl | `firecrawl` | `firecrawlFetch` | `FIRECRAWL_API_KEY`, required | `@mendable/firecrawl-js` | `scrapeUrl`, markdown format | the URL requested | `metadata.contentType` else `text/html` | `metadata.statusCode` else 200 | yes | `firecrawl.ts:17-38` |
| Jina Reader | `jina` | `jinaFetch` | `JINA_API_KEY`, optional | none | `GET https://r.jina.ai/<url>`, `Accept: application/json`; `Authorization: Bearer` only when a key exists | the URL requested | always `text/html` | the Jina response's | yes | `jina.ts:6-49` |
| Built-in | `builtin` | `builtinFetch` | none | none (bundles `@mozilla/readability`, `turndown`, `linkedom`) | local `fetch` with manual redirects, `User-Agent: Mozilla/5.0 (compatible; FlowStateDev/1.0)`, `Accept: text/html,application/xhtml+xml` | the final URL after redirects | the response header, else `text/html` | the response's | never | `builtin.ts:12-54`, `Fv:41-69` |

- Built-in extraction: Readability article as markdown, ATX headings, fenced code blocks, `-` bullets; if no article is found, the whole `<body>` as markdown (`H2M:5-9`, `17-38`). Title is the article's, else the document's. `wordCount` is whitespace-split.
- Jina is not rendered or anti-bot-handled by this package; "JS rendering" and "anti-bot" for Jina and Firecrawl are those services' own behaviour **[doc]** (`p-fetch:15-19`).
- `publishedDate` is declared in the schema but no bundled provider sets it (`Ft:18`; grep of `T/fetch/providers`).

### F-3: Provider resolution (answers "which provider when none is named")

`provider: "builtin"` → built-in. `provider: "firecrawl"` with no key → throws `Fetch provider "firecrawl" requested but no API key found. Set FIRECRAWL_API_KEY or pass it via config.keys.firecrawl`. `provider: "jina"` works with no key. With no `provider`: Firecrawl if its key is set, else Jina if its key is set, else built-in; this never throws (`Fr:18-45`; **[test]** `TT/fetch/resolver.test.ts` "never throws — builtin is always available"). Resolved on every call.

### F-4: Output (`fetchResultSchema`, `Ft:10-22`)

`{ url, title, markdown, metadata: { statusCode: number, contentType: string, description?: string, publishedDate?: string, wordCount: number }, source: "firecrawl" | "jina" | "builtin" }`. `description` is set only by Firecrawl and Jina; `publishedDate` by none. `wordCount` counts whitespace-separated tokens of the markdown (Firecrawl: `firecrawl.ts:35`, Jina: `jina.ts:45`, built-in: `H2M`).

### F-5: The built-in provider refuses non-public destinations

The built-in fetch and the built-in crawler check every URL, and every redirect hop, before opening a socket (`Fv:44-69`, `Pu:47-91`). It refuses:

- a URL that is not absolute `http`/`https` (`Fetch URL must be an absolute HTTP(S) URL`, `Fetch URL must use HTTP or HTTPS`), or has embedded credentials (`Fetch URL must not contain credentials`) (`Pu:53-64`);
- `localhost`, `*.localhost`, an empty host, and any host that resolves to a non-public address, **if any one** address in the answer is non-public (`Pu:73-88`). Non-public = IPv4 `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, and `>= 224` (`Pu:101-119`); IPv6 anything outside `2000::/3`, plus documentation ranges, with IPv4-mapped, NAT64 `64:ff9b::/96` and 6to4 judged by the embedded IPv4 (`Pu:121-167`). The page can say "private, loopback, link-local, multicast and reserved ranges"; the full table is optional.
- Redirects are followed by hand, up to **5**: the 6th redirect response throws (`Fv:16`, `65`; **[test]** `TT/fetch/providers/builtin.test.ts` "stops after the redirect budget", 6 requests). Redirect statuses 301, 302, 303, 307, 308 (`Fv:17`).
- Known limit, stated in the code's own header: DNS rebinding is **not** covered; a name that answers public to the check and private to the connection can pass (`Pu:10-16`).
- Firecrawl and Jina are exempt from this check; this package sends the URL to them without validating it (`Pu:6-8`; `jina.ts:16`).

Test helper: the vitest setup stubs DNS (`TT/setup/dns.ts`, `packages/tools/vitest.config.ts:10-11`).

### F-6: Errors

All fetch failures that carry structure are `FlowError`s (link to R-22 for the shared shape): `error.code`, `error.retryable`, `error.details`, `error.cause` (`Fe:92-179`).

`details.errorType` values (`Fe:21-28`): `http`, `network`, `timeout`, `abort`, `parse`, `blocked`, `unknown`.

| Failure | Thrown | `code` | `errorType` | `retryable` | `details` | Cite |
| --- | --- | --- | --- | --- | --- | --- |
| non-2xx from Jina or built-in | `<provider> fetch failed: <status> <statusText> for <url>` | `fetch_http_error` | `http` | 5xx, 429, 408 yes; other 4xx no | `httpStatus`, `httpStatusText`, `responseBody` (only when non-empty; truncated to 1000 characters then `…[truncated]`), `url` | `Fe:92-114`, `Fe:31`, `78-85` |
| DNS, socket, TLS failure | `<provider> fetch failed (<errorType>) for <url>`, `cause` kept | `fetch_transport_error` | `network` (any error code that is not abort/timeout), `timeout` (`TimeoutError`, or a code containing `TIMEOUT` / `ETIMEDOUT`), `abort` (`AbortError`, `UND_ERR_ABORTED`, `ABORT_ERR`) | `network` and `timeout` yes; `abort` no | `errorType`, `url` | `Fe:53-71`, `122-136` |
| Destination refused (F-5) | `<provider> fetch blocked: <reason>` | `fetch_blocked_url` | `blocked` | no | `errorType`, `url` | `Fe:147-158`, `builtin.ts:26` |
| Provider reported failure with no HTTP response (Firecrawl `success: false`) | `firecrawl fetch failed: <message> for <url>` | `fetch_provider_error` | `unknown` | no | `errorType`, `url` | `Fe:170-178`, `firecrawl.ts:23-25` |
| More than 5 redirects (built-in) | `builtin fetch failed (unknown) for <url>` | `fetch_transport_error` | `unknown` | no | `errorType`, `url` | **[ran]**; `TT/fetch/providers/builtin.test.ts` pins the code |
| No key / SDK missing for a forced provider | plain `Error` (not `FlowError`) | none | none | none | none | `Fr:23-28`, `firecrawl.ts:12-14` |

- A transport error with no recognisable code classifies `unknown`; `parse` (`SyntaxError`) is part of the classifier but "not reached today" by the bundled adapters (`Fe:57-60`). **[source]**
- A 404 is `http`, not retryable. A 403 bot wall is `http`, not retryable, with the wall's body in `responseBody`. For the built-in provider the reported URL in an HTTP error is the final URL after redirects (`builtin.ts:30-37`); for Jina it is the requested URL.
- A page with no readable content returns best-effort markdown (Readability falls back to the body) with no error (`H2M:23-31`).
- The existing page lists errorType values without `blocked` (`p-fetch:137`) and treats "URL redirects" as standard fetch behaviour (`p-fetch:151`); both are superseded by the above.
- Whether an error is retried is the generator's decision from `retryable`; that behaviour is not on this page (it is documented under error handling) **[doc]** (`p-fetch:142`).

## Table K: `tools.crawl`

### K-1: Config and call parameters

| Option | Type | Default | Set by | Effect | Cite |
| --- | --- | --- | --- | --- | --- |
| `provider` | `firecrawl` \| `builtin` | absent: auto | config | Force a provider | `Kt:41`, `Kr:17-29` |
| `maxPages` | number | 20 | **the call** | Page limit. `CrawlConfig.maxPages` is declared ("Default: 20") but the tool's input schema supplies 20 itself, so the config value never applies. **[ran]**: `crawl({ provider:"builtin", maxPages:1, maxDepth:0 })` called with `{ url }` returned 2 pages and `crawlDepth: 2`. **[test]** `tcrawl` "uses input maxPages/maxDepth over config defaults". The existing page says config sets a default the model can override (`p-crawl:69-70`); that is not what happens | `Kt:23-33`, `K:29-30`, `[ran]` |
| `maxDepth` | number | 2 | **the call** | Link depth from the root (root = 0). Same behaviour as `maxPages` | same |
| `includePatterns` | `string[]` | `[]` | config | Only these URL paths are crawled. See K-4 | `Kt:46-47`, `K:31` |
| `excludePatterns` | `string[]` | `[]` | config | Skip these. Checked first, wins over include | `Kt:48-49` |
| `waitForJS` | boolean | `false` | config | **Firecrawl only**: `scrapeOptions.waitFor: 5000` per page | `Kt:50-51`, `Kf:30-33` |
| `keys.firecrawl` | string | env | config | Beats `FIRECRAWL_API_KEY` | `Kt:53-55` |

The tool's call parameters: `url` (required), `maxPages` (default 20), `maxDepth` (default 2) (`Kt:23-33`). The existing page's "what the LLM controls vs you configure" table (`p-crawl:67-74`) needs the `maxPages`/`maxDepth` row corrected; its other four rows hold (`includePatterns`, `excludePatterns`, `waitForJS`, `provider` are config only). The one-sentence boundary framing ("limits and URL patterns are the developer's boundary") is true only for the patterns: the model sets the limits.

### K-2: Providers

| | Firecrawl | Built-in |
| --- | --- | --- |
| Constructor | `firecrawlCrawl(config)` | `builtinCrawl(config)` |
| Key | `FIRECRAWL_API_KEY`; forced with none throws `Crawl provider "firecrawl" requested but no API key found. Set FIRECRAWL_API_KEY or pass it via config.keys.firecrawl` | none |
| Package | `@mendable/firecrawl-js` (`crawlUrl`; the SDK polls until done) | none |
| `maxPages` | passed as `limit` | stops when `pages.length` reaches it |
| `maxDepth` | passed as `maxDepth` | stops enqueueing links at `depth >= maxDepth` |
| Filters | passed unchanged as `includePaths` / `excludePaths` (Firecrawl's own syntax: regex **[doc]** `p-crawl:17`) | glob against the URL path (K-4) |
| JS rendering | with `waitForJS` | no |
| Page `contentType` | always `text/html` | the response's `content-type` |
| Page `url` | `metadata.sourceURL`, else the root URL | the queued URL (the URL as linked, not the final URL after a redirect) |
| Page `description` | yes | never |
| Cite | `Kf:5-57`, `Kr:17-34` | `Kb:11-91` |

Provider resolution for crawl (answers K-3): `provider: "builtin"` → built-in; `provider: "firecrawl"` → Firecrawl or throws without a key; otherwise Firecrawl if `FIRECRAWL_API_KEY` (or `keys.firecrawl`) is set, else built-in. Never throws for lack of a provider (`Kr:17-37`; **[test]** `TT/crawl/resolver.test.ts`).

### K-4: Built-in crawler behaviour (`Kb`)

- Traversal: breadth-first from the root; each hop is `depth + 1`; it stops at `maxPages` collected pages or when the queue is empty; links are enqueued only from a page whose `depth < maxDepth` (`Kb:19-81`).
- Same-origin only: a link is followed only if its origin equals the **root's** origin and its protocol starts with `http` (`Kb:102-123`). Links are read from `<a href="…">` in the raw HTML with a regular expression (`Kb:107`).
- De-duplication: the URL's `#hash` is removed and one trailing `/` is removed from non-root paths before the visited check (`Kb:93-100`).
- Rate: a 1000 ms delay before each request **once at least one page has been collected** (`Kb:37-40`).
- Skipped without error: any request that fails (network, blocked URL, redirect overflow), a non-2xx response, a response whose `content-type` does not contain `text/html` (`Kb:46-51`, `77-80`). This includes the root: an unreachable, blocked or non-HTML root yields `pages: []`, `totalPages: 0`, no error. **[test]** `tcrawl` "handles fetch failures gracefully", "does not request a private root URL".
- The destination check of F-5 runs on every queued URL and redirect hop (`Kb:42-46`).
- `crawlDepth` in the result is the **limit** used (`maxDepth`), not the depth reached (`Kb:87`, `Kf:53`; **[ran]**).
- Not handled: JavaScript rendering, anti-bot protection, authentication or cookies. `robots.txt` is not read (no code reads it) **[source]**.
- Error table: the only throw is an invalid root URL string (`new URL(rootUrl)` throws `TypeError: Invalid URL` before the loop, `Kb:14`) **[source]**; a forced Firecrawl with no key, a missing SDK, or anything the Firecrawl SDK itself throws (the adapter does not look at a `success` flag) (`Kr:22-27`, `Kf:10-34`). `maxPages` bounds a crawl of an unbounded site.

### K-5: Include and exclude patterns (built-in) (`Kb:127-149`)

Matched against the URL's **path** (`new URL(url).pathname`, so a trailing `/` counts), anchored at both ends. `**` matches any characters including `/`; `*` matches within one segment (no `/`); `?` matches one character that is not `/`. Empty include list: everything same-origin allowed. Empty exclude list: nothing excluded. Exclude is checked first and wins. Other characters are **not** escaped, so a `.` in a pattern matches any character **[source]**. `/docs/**` does not match `/docs` (no trailing slash) **[source]**, derived from `^/docs/.*$`. The patterns also apply to the root URL's path: a root that fails `includePatterns` is skipped, giving an empty result **[source]**. **[test]** `tcrawl` pattern tests (`includes all when no patterns specified`, `exclude takes precedence over include`, `matches ** as any path`, `matches * as single segment`).

### K-6: Output (`crawlResultSchema`, `Kt:11-17`)

`{ rootUrl: string, pages: FetchResult[], totalPages: number, crawlDepth: number, source: "firecrawl" | "builtin" }`. Each page has the F-4 shape. `totalPages` = `pages.length`.

## Table B: Bash

### B-1: Entry points

| Entry | Returns | Default provider | Default destination | Mounts | Cite |
| --- | --- | --- | --- | --- | --- |
| `createBashCapability(options)` | a `defineCapability` with presets `tools` (`bash`, `bash-read-file`, `bash-write-file`), `guidance` (a per-turn context string), default both; plus `cleanupBlock` (a handler named `bash-cleanup`) | `just-bash` | `/workspace` (`/vercel/sandbox/workspace` for Vercel) | auto-discovered from `ctx.resources`, narrowed by `collections` / `exclude` | `Bc:215-267` |
| `createBashBlocks(options)` | `{ bashCommand, bashReadFile, bashWriteFile }` handler blocks (sequencers wrapping the leaf for `vercel`, `upstash`, all three; for `moat` only `bashCommand` and `bashReadFile`, `bashWriteFile` stays the host-fs handler) | **`local`** | same | same | `Bb:717-724`, `1045-1095` |
| `createBashTool(options)` | `Promise<{ tools: { bash, readFile, writeFile }, sandbox }>`; AI SDK `tool()` objects to pass as `providerTools` | `just-bash` | `/workspace` (always, even for Vercel) | only the `collections` you pass (a record of name → collection ref); no `exclude`; all mounts writable | `Bk:63-74`, `98-126`, `228` |

The capability's `provider` default is `just-bash` (`Bc:219`) while `createBashBlocks`' is `local` (`Bb:721`); the doc comments agree with code. `createBashCapability` and `createBashBlocks` read `ctx.resources` at the first command of a sandbox and **fix the mounts then** (`Bb:789-797`); the guidance string, however, is rebuilt each turn from the current context (`Bc:79-93`).

`createBashCapability` options (`Bc:43-69`): `collections` (`string | { key, writable? }[]`; strings are writable; when set, `exclude` is ignored), `exclude` (`string[]`), `provider`, `destination`, `createState` (`(relativePath) => ProjectedEntryExtra`; default stamps `{ title: <basename> }`; the blocks default is `{}`; it cannot set `path`/`hash`/`updatedAt`). A requested collection key not on `ctx.resources` logs `[bash] collection "<key>" was requested but not found on ctx.resources — skipped` (`Bb:559-567`). A collection with no pattern prefix, or whose prefix is `tmp`, is not mounted (`Bb:546`).

`createBashTool` options (`Bt:348-376`): `collections`, `bashSession` (a `ResourceRef<BashSessionState>`), `provider`, `destination`, `persist` (default `false`), `onBeforeCommand(cmd) => string | void` (a returned string rewrites the command), `onAfterCommand(cmd, result) => CommandResult | void` (a returned result replaces it). Differences from the capability: no auto-discovery, no guidance text, no `exclude`, no read-only mounts, no per-scope workspaces (`provider.type: "local"` with a `scope` **throws** at call: `[bash] scope: "<scope>" is not available from createBashTool ...`, `Bk:82-88`), no idle release or cleanup block (call `sandbox.stop()` yourself). The `bash` tool does **not** prefix a `cd`; the blocks do (`Bb:920`). The tool description lists the files hydrated (`Bk:159-163`).

### B-2: Tools the model sees (capability and blocks)

| Block name | Input | Output | Behaviour | Cite |
| --- | --- | --- | --- | --- |
| `bash` | `{ command: string }` | `{ stdout, stderr, exitCode }` | Runs `cd <destination> && <command>`, then flushes the workspace back to the collections. A non-zero exit does not throw | `Bb:124-132`, `922-935` |
| `bash-read-file` | `{ path }` (workspace-relative, "Don't prefix with `/workspace`") | `{ content }` | Reads from the sandbox. No flush | `Bb:134-144`, `937-952` |
| `bash-write-file` | `{ path, content }` | `{ success: boolean, refused: string \| null }` | Writes to the sandbox, then commits only that path through the same check a flush uses | `Bb:146-167`, `1028-1043` |

For `vercel`, `upstash` the three are sequencers (for `moat`, `bashCommand` and `bashReadFile` are; `bashWriteFile` is the host-fs handler, `Bb:1084-1095`) that run a status step (`Preparing bash sandbox (<provider>)…`; for moat `Preparing bash sandbox (moat — first run can take 30–60s while the image builds)…`) the first time a scope is used, and for moat a background purge (see MOAT-6) (`Bb:834-849`, `855-881`, `1053-1095`). The inner leaf names are `bash-<provider>-exec`, `bash-<provider>-read-file-exec`, `bash-<provider>-write-file-exec` (`Bb:923`, `938`, `1029`). For moat `bash-write-file` writes straight to the host directory without starting the container (`Bb:967-1026`).

`bash-write-file` / `writeFile` result (`refused` text, from `Bp:173-192`): `success` is `true` when the file reached its collection or `./tmp/`; otherwise `success: false` and `refused` is one of:

| Cause | `refused` |
| --- | --- |
| path under no mounted collection | `"<path>" is not under any mounted collection or ./tmp/, so it was not saved.` |
| the collection's entry changed since the run last saw it | `"<path>" changed in its collection while this run held it — the write was NOT applied.` |
| another run is writing that entry now | `"<path>" is being written by another run — the write was NOT applied.` |
| a read-only mount | `"<path>" is under "<prefix>/", which is read-only — the write was NOT saved, and retrying will not save it.` |

The workspace file is written in every case; only the durable half is refused (`Bb:155-167`). A leading `./` is stripped; a path under `tmp/` and the marker file name return `success: true` without touching a collection (`Bb:687-692`). **Discrepancy, `createBashTool` only**: its `writeFile` does not special-case `tmp/`, so `writeFile({ path: "tmp/x.txt" })` returns `success: false` with the "not under any mounted collection or ./tmp/" text, and `[bash] dropped 1 orphan file(s)...` is logged. **[ran]** (`Bk:207-214`).

### B-3: Sandbox providers (`SandboxProvider`, `Bt:146-309`)

Six types. Constructors take the config shape below as `provider`.

| `type` | Config | Default / rule | Real filesystem | Cite |
| --- | --- | --- | --- | --- |
| `local` | `cwd?`, `scope?`, `strictPaths?`, `env?`, `execTimeoutMs?` | `cwd` absent → `<process.cwd()>/.fsdev/workspaces/<scope>/<…>` under the blocks/capability, `<process.cwd()>/.bash-workspace` under `createBashTool`; `scope` default `session`; `strictPaths` default `true`; `execTimeoutMs` default 60 000. `cwd` **and** `scope` together throws at construction (`createBashBlocks` / `createBashCapability`) | yes, the host's | `Bt:147-201`, `Bb:583-593`, `1125-1133`, `lf:94-97` |
| `just-bash` | `env?`, `network?`, `python?`, `javascript?`, `executionLimits?` | `network` off by default; `python`, `javascript` off. In-memory bash emulation; no real processes; 60+ built-in commands (`curl`, `find`, `jq`, `awk`, `sed`, `grep`, `rg`, `sort`, `yq`, `html-to-markdown`…); cannot install packages | no (in-memory) | `Bt:239-251`, `jb:1-13`, `Bc:98-116` |
| `vercel` | `Sandbox` (the `@vercel/sandbox` class), `sandboxId?`, `createOptions?` | the consumer passes the SDK class in; there is no peer dependency on it. `sandboxId` reconnects (`Sandbox.get`), absent creates (`Sandbox.create(createOptions)`). Default destination `/vercel/sandbox/workspace`. Commands run as `sh -c` | yes (remote) | `Bt:202-226`, `Br:70-77`, `vc:98-121`, `Bb:341-344` |
| `upstash` | `client` (an object with `id`, `exec`, `read`, `write`, `destroy`), `boxId?` | **Not implemented.** Resolving it throws `Upstash Box adapter is not yet implemented.` **[test]** `tbash` ("upstash" block, rejects "not yet implemented"); the package README calls it a "Placeholder" (`readme:200`) | n/a | `up:155-164`, `Bt:227-238` |
| `moat` | see MOAT-3 | see MOAT | yes (host dir, bind-mounted) | `Bt:252-308` |
| `custom` | `sandbox: Sandbox` | whatever you implement | yours | `Bt:309` |

`just-bash` fallback: if `import("just-bash")` or construction throws for any reason, the adapter silently falls back to the in-memory map described in T-1 (`jb:42-83`). The existing page's error table says "Falls back to an in-memory Map-based sandbox" (`p-bash:386`); the page should say that sandbox runs no commands.

`NetworkConfig` (just-bash): `dangerouslyAllowFullInternetAccess?: boolean`, `allowedUrls?: { url, methods?, headers? }[]` (`Bt:75-84`). `ExecutionLimits`: `maxCallDepth`, `maxCommandCount`, `maxLoopIterations`, `maxAwkIterations`, `maxSedIterations` (`Bt:87-93`). `javascript?: boolean | { bootstrap?: string }` is QuickJS (WASM) run as `js-exec` (`Bt:247-248`, `Bc:104-106`).

`Sandbox` interface (what `custom` implements): `executeCommand(command): Promise<CommandResult>`, `readFile(path): Promise<string>`, `writeFile(path, content): Promise<void>`, optional `stop()`, optional `hostMountSource` (`Bt:30-45`). `CommandResult` = `{ stdout, stderr, exitCode }` (`Bt:17-21`).

**Local provider details**

- Environment per command: only `PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR`, `TZ` copied from the server when set, plus `env`; `env` wins over the defaults, `PATH` included (`lf:70`, `98-103`; **[test]** `tlim` "lets a caller's `env` override a base variable", "does not leak the server's environment"). What to pass (API tokens, proxy settings such as `HTTPS_PROXY`/`NO_PROXY`, custom CA bundle paths, `SSH_AUTH_SOCK` for git over ssh) is stated in the README and `p-bash:109` **[doc]**; the code does not special-case any of them.
- Isolation: same OS user as the server; a command can read the server's environment (`/proc/$PPID/environ`, `ps eww`); a process that leaves its group (`setsid`, a daemon) survives timeout and `stop()`. Use `moat` or a container for untrusted commands (`lf:22-27`, `Bt:184-192`).
- Exit codes: the shell's own; `124` on timeout (message `exec timed out after <n>ms` appended to `stderr`); `128 + n` when killed by signal `n`; `1` for output over **10 MiB on one stream** (each stream counted separately; the command is killed) or a spawn failure (`lf:245-248`, `272-282`, `301-322`, `readme:214-218`; **[test]** `tlim`).
- Background jobs: a job started with `&` outlives its command; `stop()` ends every process group the sandbox's commands started (SIGTERM, then SIGKILL after 2 s) (`lf:17-20`, `196-209`; **[test]** `trel`). Linux/macOS process-group model (`lf:14-15`).
- `strictPaths` (default `true`): before each command the raw string is screened for `~/`, `$HOME`, `$(...)`, backticks, `<(...)`, `>(...)`, `../`, then each unquoted absolute-path token must resolve inside the workspace (or be one of `/dev/null`, `/dev/stdin`, `/dev/stdout`, `/dev/stderr`, `/dev/zero`, `/dev/urandom`, `/dev/random`, `/dev/fd`). A violation **throws** `Command rejected: token "<token>" resolves to a path outside the workspace root (...)`. Quoted strings and heredoc bodies are not checked, so `cat "/etc/passwd"` passes. File read/write paths are resolved inside the workspace and throw if they escape. It is "best-effort for cooperative agents, not a security boundary" (`wg:1-20`, `29-43`, `98-117`, `150-154`, `readme:357-375`). `strictPaths: false` logs a warning and skips every guard (`lf:111-116`).

### B-4: Workspace scope (local provider, capability and blocks)

Directory: `<process.cwd()>/.fsdev/workspaces/<scope>/<components>` (`Bb:322-325`, `592`). `scope` is `run` | `session` (default) | `user` | `org` (`Bt:96`, `173`). Every component is encoded as `enc-<id with non [A-Za-z0-9_-] replaced by "-", first 40 characters>-<first 12 hex of a SHA-256 of the exact id>`; an absent component is `enc-none` (`Bb:375-386`, `493-497`). So a real path looks like `.fsdev/workspaces/run/enc-none/enc-req_x1y2-<12 hex>/enc-inc_9f-<12 hex>` **[test]** `tscope` ("keeps an ordinary id legible in the name it encodes to", line 151-163); the existing page's `<tenant>/<id>` is shorthand.

| `scope` | One workspace per | Components after `<scope>/` | Carries tenant | Cite |
| --- | --- | --- | --- | --- |
| `run` | request | tenant, request id, request incarnation | yes | `si:86-106`, `Bb:466-476` |
| `session` (default) | session | tenant, session id | yes | `si:99-106` |
| `user` | user | user id | no | `si:90-99` |
| `org` | org | org id | no | `si:90-99` |

- `run` and `session` carry the tenant because their ids arrive in the request body; `user` and `org` are keyed on a verified identity and are shared across tenants by design (`si:78-85`, `Bb:421-453`).
- Fallbacks: `user` with no `userId` uses the **session** workspace (tenant included); `org` with no `orgId` does the same. The caller gets a narrower workspace, never a shared one (`si:94-98`, `101-104`). The existing page says an `org` workspace "always has an organization to key on" (`p-bash:300`); the code has the fallback.
- Run incarnation: stamped once when the request is first recorded; a retry or resume of the same request reuses the directory; a new request that reuses the id after the first's record was deleted gets a new, empty directory (`si:40-46`, `si:72-81`, **[test]** `tscope` line 338 "gives a new request under a reused id a new workspace, and the same request its own"). A context with no incarnation keys on a marker of its own (`WT/scope-identity.spec.ts:58`).
- Cleanup: finished directories are not removed; nothing reads them again (`p-bash:285-286`; no code removes them) **[source]**.
- Only `local` takes a scope. Every other provider is one sandbox per session (`Bb:455-464`).
- Sharing: every scope below `run` is a workspace two runs can be inside at once; only `run` gives one request a workspace nothing else shares (`Bt:166-172`). `run` fits a flow that fans several agents out at once; `session` a conversation whose runs build on each other.

### B-5: Mounts, hydrate and flush

- Mount discovery: each entry of `ctx.resources` that is a collection ref (has a string `pattern` and a `list` function) is mounted at its pattern's directory prefix (`artifacts/**` → `<destination>/artifacts/`); registry helper functions are skipped; longest prefix first (`Bb:518-573`, `Bc:171-195`).
- Hydrate: write `.fsdev-keep` (an empty marker) under `tmp/` and under each mount prefix, then lay every entry into the sandbox (`Bp:63-72`, `Bb:664-667`). The marker name is reserved and filtered from every listing (`Bs:27`, `85-93`).
- Flush (after `bash` only): list the mount directories plus the files **directly in the workspace root**; for each file decide against the collection (`Bs:152-167`, `Bs:217-241`). Unmounted subdirectories are not walked, so a file there is dropped without a warning (`Bs:138-145`; `p-bash:356`). `node_modules` and `.git` trees under a mount are never listed or persisted (`Bs:110-127`) **[source]** (new to the page).
- A file under a writable mount is upserted to its collection with the prefix stripped; under a read-only mount it is skipped (a flush keeps no baseline there); under `tmp/` it is skipped silently and never persisted; a root-level file under no mount is an **orphan**: dropped, with `console.warn` `[bash] dropped N orphan file(s) not under any mounted collection (or ./tmp/): ...` (`Bp:200-206`, `Bs:129-132`).
- A file the run removed is deleted from its collection only if the projection owns it (laid down or committed earlier) and nobody else changed it (`pj:309-348`). A file another run added is never deleted by this one.
- Change detection: SHA-256 of content (`hashContent`); only differing files are written (`pj:42-45`, `376-379`).
- Failure handling: if the walk (`Place.list`) fails, the flush is skipped and logged (`[bash] flush skipped — workspace walk failed: ...`) and the command's result is still returned; every other failure (a collection read or write) propagates (`Bp:133-148`). A file that exists but cannot be read throws `[bash] <path> is in the workspace but could not be read: ...` (`Bs:60-65`). A flush that reached only orphans on a writable-mount session logs `[bash] flush walk found 0 files under writable mounts (...)` (`Bp:240-254`).
- State stamped on each written entry: `path`, `hash`, `updatedAt` (`ProjectedEntryState`, `packages/workspace/src/types.ts`) plus `createState(relativePath)` extras. The collection's `stateSchema` must accept those three fields (`p-bash:358-375`). File content is in the entry's content, not its state.
- `bash-write-file` for moat writes to the bind-mounted host directory first and refuses a `..` path or a symlink that escapes the mount (`MoatPathEscapeError`) (`Bb:1019-1022`, `mo:119-124`, `1033-1047`).
- Conflict, contested and read-only behaviour is the projection's: see W-4 to W-8. The bash page-level rules ("the collection entry is the unit, not the path"; "a refused write still lands in the workspace") hold (`Bb:155-167`, `si:139-148`).
- Sandbox lifetime: one sandbox per (scope, identity) kept in a process-wide map; created at the first command, **not persisted**, lost on server restart. Released on request end if `cleanupBlock` is wired, and in any case after **30 minutes** with no command (`SANDBOX_IDLE_RELEASE_MS`); an in-flight command is never released; the clock restarts when a command finishes; the timer does not keep the process alive (`Bb:205-271`, `217`; **[test]** `trel` lines 178-267).

### B-6: Sandbox cleanup

The capability returns `cleanupBlock` for **every** provider (a handler named `bash-cleanup`). Wire it: `defineFlow({ request: { onFinished: bashCap.cleanupBlock } })` (`Bc:250-264`). It is optional for every provider, because an unused sandbox is released after 30 minutes anyway (`Bc:250-257`). What release does: a local sandbox's background jobs are stopped; a MOAT container is stopped only when `persist: false` (the capability default is `persist: true`, so for MOAT the release is the 30-minute idle stop); custom: `sandbox.stop?.()` is called, so a `custom` sandbox that implements the optional `stop()` is stopped on cleanup and on idle release; just-bash has no `stop()`, so nothing; Upstash is not implemented; Vercel: `sandbox.stop()` (`lf:196-209`, `mo:1179-1202`, `vc:83-85`, `Bb:1152-1197`). Errors on release are logged, never thrown (`Bb:1148-1150`). For `createBashTool` call `sandbox.stop()` yourself. The existing page says cleanup is "required" for MOAT (`p-bash:212`; README `readme:251`); the code says optional (above). That page also says it is a no-op for persisting MOAT; that is true for `sandbox.stop()` but the idle release then stops it (`Bb:728-753`).

### B-7: MOAT (`provider: { type: "moat", ... }`)

**MOAT-1 What it needs.** The `moat` CLI, installed by the host operator (the package neither bundles nor installs it); version `>=0.4.0` (`mo:131`, `538-570`); macOS with the Apple container runtime, or a Linux host with Docker **[doc]** (`p-bash:144`; `moat` runtimes `auto | docker | apple`, `Bt:278`). Preflight on first use: `moat version --json` (a `0.4.x`–`0.5.x` text fallback is parsed), then `moat grant list --json` if `grants` is set (`mo:538-597`). A 10 s cap bounds each control command (`mo:536`).

**MOAT-2 What it costs.** No network round trip per command: commands are `moat exec <run> -- sh -c ...` against a local container (`mo:1075-1110`). A cold start takes "~10–30s" (`Bb:595-598`); a first run that builds the image "30–60+ seconds" (`mo:1254-1258`, `Bb:843`); the readiness wait gives up after **60 s** with `MoatRunTimeoutError` (`mo:1259`, `1415-1462`; not configurable from the provider config). Both figures are the code's own comments, approximate.

**MOAT-3 Provider options** (`Bt:252-308`):

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `workspace` | string | the resolved workspace directory (`.fsdev/workspaces/session/<…>` under blocks/capability) | Host directory bind-mounted into the container |
| `mountTarget` | string | `destination` (`/workspace`) | Mount point inside the container |
| `runName` | string | `fsdev-<sanitized session id, 20 chars>-<12 hex digest of the tenant+session key>` under blocks/capability (`Bb` `defaultMoatRunName`); under `createBashTool` there is no session identity: the persisted `bashSession.sandboxId` if any, else `fsdev-<random UUID>` (`Br:96`) | The MOAT run (container) name. An explicit one is **shared** by every session that uses the provider |
| `grants` | `string[]` | none | Grant names that must already exist (`moat grant <name>`); missing ones throw `MoatGrantsError` before the run starts. Credentials stay with MOAT; the framework declares only the names |
| `allowHosts` | `string[]` | `[]` (default-deny) | Outbound host allowlist: `--allow-host` per entry and `network.allow` in the generated `moat.yaml` |
| `runtime` | `auto` \| `docker` \| `apple` | `auto` | Container runtime (also sets `MOAT_RUNTIME` for the CLI calls) |
| `noSandbox` | boolean | `false` | Pass `--no-sandbox` (disables gVisor under Docker) |
| `configPath` | string | none | A hand-written `moat.yaml`. Used directly if inside the workspace; otherwise copied to the workspace root (stamped `# fsdev-managed: do not edit`) and removed at teardown. Refuses to overwrite an existing unmarked `moat.yaml` |
| `execTimeoutMs` | number | 60 000 | Per-`moat exec` timeout |
| `bin` | string | `moat` | The binary name or path |
| `persist` | boolean | `true` under the capability and blocks, `false` under `createBashTool` | See MOAT-5 |

`mo:1286-1367` (config handling), `Bb:595-619` (blocks defaults). Without `configPath` the adapter writes a generated `moat.yaml` (`name`, optional `grants`, `network.policy: "strict"`, `network.allow`) first-line-marked `# fsdev-managed: do not edit` into the workspace and `<tmp>/fsdev-moat/<runName>` (`mo:249-273`, `1355-1365`). A hand-authored `moat.yaml` in the workspace with no marker and no `configPath` is refused: `Refusing to overwrite existing <path>. Pass it explicitly via provider.configPath (it will be left untouched), or remove it.` (`mo:1332-1336`).

**MOAT-4 Isolation.** The container starts with a clean environment; outbound requests go through a credential-injecting proxy, so credentials held by MOAT never appear in the agent's environment, unlike tokens passed in `env` on the local provider (`mo:1-25`) **[doc]**. The adapter does not check path containment on commands; the boundary is the container (`mo:11-12`).

**MOAT-5 Persistence.** With `persist` on, `sandbox.stop()` leaves the container and its generated `moat.yaml` in place; the next request finds it by run name through `moat list --json` and reuses it (`mo:1179-1186`, `1392-1396`). Changing `grants` or `allowHosts` does not apply to a live container: stop it first (`moat stop <runName>` or `moat clean`) (reconnection skips `moat run`, `mo:1394-1396`). The container outlives the framework process when the server exits. Under blocks/capability with a **per-session** run name (no explicit `runName`) and `persist` not `false`, a container no command has used for 30 minutes is stopped and destroyed by the server (`Bb:728-753`; **[test]** `tmoat` "keeps a persisting container across requests, then stops it once idle for 30 minutes"). An explicit `runName` container is left to its operator (`tmoat` "leaves a container shared under an explicit runName to its operator"). `persist: false`: `stop()` runs `moat stop` then `moat destroy` and removes the generated config (`mo:1186-1201`).

**MOAT-6 Pool bound.** On a cold start the blocks run a background purge: of the runs named `fsdev-*`, all but the **50** most recently started are stopped and destroyed, oldest first, excluding the current one (`mo:793-856`, `Bb:855-881`). Best-effort, failures logged (`[moat] purge of stale containers failed`).

**MOAT-7 Limits.**

| Limit | Behaviour | Cite |
| --- | --- | --- |
| command timeout | default 60 s; the command is also stopped inside the container; result `exitCode: 124`, `stderr` ends `exec timed out after <n>ms` | `mo:1084-1103` |
| output | buffered, not streamed; over 10 MiB on one stream kills the command, `exitCode: 1` | `mo:296`, `1096-1102` |
| `readFile` | UTF-8 text only; undecodable bytes throw `MoatBinaryReadError`; missing file `FileNotFoundError` (`File not found: <path>`); a path whose `..` climbs out of the mount throws `MoatPathEscapeError` | `mo:94-124`, `1112-1156` |
| after `stop()` | any command throws `MoatRunStoppedError` | `mo:87-92`, `1021-1023` |
| crash | a crashed container is not restarted; the next command surfaces the failure | **[doc]** `p-bash:250` |
| SIGTERM or host crash | the container keeps running (no code path stops it) | **[doc]** `p-bash:251`, `[source]` |
| not installed / too old / no grant | `MoatNotInstalledError`, `MoatVersionError`, `MoatGrantsError` (message lists `moat grant <name>` lines) | `mo:47-71` |

The MOAT error classes carry their name in `error.name` but are not exported from `@flow-state-dev/tools/bash`.

## Table MCP: `@flow-state-dev/tools/mcp`

**MCP-1.** Install: the optional peer `@ai-sdk/mcp` (`pkg:106`). The client is imported on first connection (`M/manager.ts:134-143`). A server that fails to connect (including a missing `@ai-sdk/mcp`) is marked `errored` in the catalog with a message that has the server's header values removed (credential words too, keeping a leading scheme word such as `Bearer`), logged `[mcp] Failed to connect to "<name>": ...`; other servers still load (`manager.ts:156-192`, `118-132`; **[test]** `tmcp` call-tool.test.ts lines 88, 107, manager.test.ts line 152). Connection is lazy: nothing connects until the first `getTools()` or `callTool()` (`manager.ts:194-199`, `tmcp` manager.test.ts line 19).

**MCP-2 Server config** (`MCPServerConfig = { name, transport } & MCPServerMetadata`, `M/types.ts:13-34`):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Namespaces tools as `mcp__<name>__<tool>` |
| `transport.type` | `"http"` \| `"sse"` | yes | `http` is Streamable HTTP |
| `transport.url` | string | yes | |
| `transport.headers` | `Record<string,string>` | no | May carry credentials; `getServerConfigs()` returns them, so never log or emit that result |
| `description` | string | no | Shown **only** in the guidance block |
| `whenToUse` | string | no | A `Use when: ...` line in the guidance block |
| `examples` | `string[]` | no | An `Examples:` list under the server's section |
| `category` | string | no | Groups servers under a `### <Category>` heading in the guidance block (hyphens become spaces, first letter capitalised; servers with none go under `Other`, last). With `enrichDescriptions: "category"` it also prefixes tool descriptions `[<server> · <category>]` |

Cite: `context.ts:13-17`, `55-63`, `77-105`; `enrich.ts:17-27`. The existing page says `description` also appears in tool descriptions under `enrichDescriptions: "category"` (`p-mcp:61`); the code uses only `name` and `category` there. The SSE-migration remark in the type's comment is provider history and is not carried.

**MCP-3 Capability options** (`createMcpCapability`, `M/types.ts:131-146`, `capability.ts:49-78`):

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `servers` | `MCPServerConfig[]` | — | Builds an internal manager. Exactly one of `servers` or `manager` |
| `manager` | `MCPManager` | — | Use a manager you built |
| `filterTools` | `(ctx, tools) => tools \| Promise<tools>` | `defaultMcpFilterTools` | Replaces the default unless you call it inside yours |
| `enrichDescriptions` | `"prefix"` \| `"category"` \| `false` | `"prefix"` | `[<server>] <desc>`; `[<server> · <category>] <desc>` (falls back to the prefix form for a server with no category); `false` leaves it |
| `formatGuidance` | `(catalog) => string` | `defaultMcpGuidanceFormatter` | Builds the system-prompt block |

Presets: `tools` (the filtered, enriched tool list) and `guidance` (a context string under the key `mcp`); both default on. Turn one off with `mcpCap.with({ guidance: false })` / `.with({ tools: false })` (`capability.ts:61-77`, `p-mcp:108-109`, `tmcp` capability.test.ts line 14).

**MCP-4 Per-request gating.** The capability contributes request state `mcp.disabledServers: string[]` and `mcp.disabledTools: string[]` (tool names, namespaced) (`filter.ts:16-26`). `defaultMcpFilterTools` removes matching tools; `disabledTools` is matched on `tool.name` before the marker is read, so a listed tool is removed even if it did not come from an MCP server; only `disabledServers` spares tools with no MCP marker (`filter.ts:43-44`). This narrows the tool list for the request and leaves connections open. For session-wide disabling, write a `filterTools` that composes over `defaultMcpFilterTools` (`filter.ts:33-47`; `p-mcp:70-90`).

**MCP-5 Guidance block** (`defaultMcpGuidanceFormatter`, `context.ts:70-108`): connected servers only (errored and pending are omitted). No connected servers → empty string. If no connected server sets `description`, `whenToUse` or `examples` (`category` alone does not count) → a short block (`## MCP Tools`, the server names, and the `mcp__<first server>__tool_name` prefix hint). Otherwise a full block grouped by category; a server with none of the three gets one line: `Tools are prefixed with \`mcp__<name>__\`. Consult their descriptions to decide when to call.` **[test]** `tmcp` context.test.ts.

**MCP-6 Manager** (`createMcpManager({ servers })`, `manager.ts:145-256`, `types.ts:99-119`): `getTools()` (all servers' tools as handler blocks named `mcp__<server>__<tool>`; input schema is the server's own JSON Schema; the server validates arguments; a tool the server marks as not executable returns `{ error: "Tool <t> on server <s> does not support execution." }`), `getCatalog()` (`{ servers: [{ name, metadata, status: "pending" \| "connected" \| "errored", error?, tools: [{ name, originalName, description, inputSchema, jsonSchema }] }] }`; callable before connection, then `pending`), `getConnectedServerNames()`, `getServerConfigs()`, `callTool(name, args, { signal? })` (a tool by its namespaced name, returns what the server's client returned; connects first; throws `No connected MCP server has a tool named <name>.` for an unknown name or a server that failed to connect; an already-aborted signal throws before the call), `close()` (idempotent; resets to `pending`). `jsonSchema` is the plain JSON Schema the server published, `{ type: "object" }` when none (`manager.ts:91-100`). The connection description sentence for a Workforce coding run is a link to the Workforce projects page, not a row.

## Table W: `@flow-state-dev/workspace` (projection, places, branch pull requests)

All of W-1 to W-12 are carried from the routed rows after checking each against code.

### W-1: What a mount is (`Mount`, `wt:69-129`)

| Field | Type | Effect |
| --- | --- | --- |
| `prefix` | string | Where the collection's entries appear in the place (`artifacts` → `artifacts/notes.md`) |
| `collection` | collection ref | The durable side |
| `collectionId` | string | Required. What the collection **is**: the same string for two runs addressing the same rows. Build with `collectionIdFor(collection, principalFromContext(ctx))` |
| `scope` | string | Optional key prefix inside the collection (`"a"` addresses `a/…`); not visible inside the place; no leading, trailing or repeated `/`, no `.` or `..` segment (`assertScope` throws otherwise, `pj:493-500`). Omitted: the whole collection |
| `writable` | boolean | `false`: hydrated, then never flushed back |
| `entryState` | `(key) => ProjectedEntryExtra` | Extra fields stamped on each committed entry (a title, an author). Returns anything **except** `path`, `hash`, `updatedAt`: those belong to the projection and win; the type forbids them and a value that arrives anyway is ignored |

Cites: `wt:56-66`, `wt:128`, `pj:457-475` (`{ ...extra, path: key, hash, updatedAt }`, "Extra first, so a mount cannot replace path, hash, or updatedAt"), **[test]** `tpj` "keeps the projection's path, hash, and updatedAt when entryState sets them" (line 592), "stamps them on an entry that already existed" (579). **Correction**: the routed row says `entryState` is "applied last so it can override"; that is false (and so is `p-ws:58`). `createProjection` throws when two mounts share one `collectionId` (`a projection cannot mount one collection twice ...`, `pj:115-132`; **[test]** `tpj` line 881). Two different collections at nested prefixes are allowed (`tpj` line 899).

### W-2: Routing

The mount owning a path is the **longest matching prefix**; the boundary has to be a `/`, so `artifacts-old/x` belongs to neither `artifacts` nor its collection; the path equal to the prefix routes to nothing; a path under no mount is an orphan (`rt:29-62`; **[test]** `tpj` "the longest matching prefix wins" (298), "a neighbouring prefix is not a match" (319)). Paths are normalised: backslashes to `/`, a leading `./` and leading `/` removed (`rt:25-27`). A collection's own bookkeeping keys (bare key starting `_`) are never hydrated, flushed or put (`rt:76-78`, `pj:289`, `439`); a `_` deeper in a path is an ordinary name (`tpj` line 805).

### W-3: Flush outcomes (`FlushOutcome`, `wt:138-200`; `FlushReport` = `{ outcomes, conflicts, contested }`, `wt:203-210`)

`flush()` resolves with an outcome for every path it reached; it throws `PlaceUnreadableError` when `place.list()` fails, and rejects with the underlying error when a collection read, write or delete fails (`pj:70-76`, `247-258`; see W-8). Hydrate first records, per path of a **writable** mount, a baseline hash of what the projection laid down (`pj:197-223`).

| `kind` | When | Cite |
| --- | --- | --- |
| `unchanged` | the place's content hashes to the baseline | `pj:379` |
| `created` | no baseline and the collection holds nothing: written | `pj:402-406` |
| `written` | the collection still holds what the projection last committed: written | `pj:407-411` |
| `converged` | the collection already holds exactly this content: nothing written, baseline advances | `pj:412-419` |
| `deleted` | the projection owned the path, the run removed it, and the collection still held what the projection committed (or the entry was already gone) | `pj:309-336` |
| `orphan` | a path no mount owns. From `put` it is any path under no mount. A **flush** reports it only for a path inside a mount prefix that nothing owns, because it lists the place by mount prefix: a file written outside every prefix is never walked, never reported by the projection | `wt:152-163`, `pj:281-284`, `432` |
| `readonly` | `put` only: the path is under a read-only mount (carries `prefix`). Never clears on retry. A flush skips read-only paths and never reports this | `wt:164-175`, `pj:445-447` |
| `contested` | another live operation holds this entry (W-7) | `wt:176-186` |
| `conflict` | two writers; carries `path`, `base`, `theirs`, `ours` (W-5) | `wt:187-200` |

The routed row says `orphan` is "a file written outside every writable mount"; for a read-only mount a flush skips and `put` returns `readonly`, so `orphan` means "under no mount at all". `orphan` is "never filed into a default collection" (`rt:36-37`, `tpj` lines 332 and 497). In the bash tools the **bash layer** also scans the workspace root and reports root-level files as orphans (B-5).

### W-4: Conflict (`wt:187-200`, `pj:420-426`, `337-347`)

A conflict is an outcome of a flush that succeeded: everything uncontested still landed; the contested path is left exactly as both writers left it (nothing written, nothing deleted); `report.conflicts` carries, per entry, `path`, `base` (what the projection last committed, or `null`), `theirs` (what the collection holds now as a hash, or `null`), `ours` (what the place holds now as a hash, or `null` when the run deleted it). A delete where the collection changed underneath is a conflict with `ours: null`. Values are SHA-256 hex hashes. **[test]** `tpj` "conflict: carries base, theirs and ours" (115), "a delete we cannot prove safe is a conflict" (208), "the same path is a reported conflict, not a lost update" (262), "disjoint paths both land" (233).

### W-5: Path ownership

The projection's baseline map is its ownership: it **grows** as the projection commits (a created-and-flushed file belongs to it from then on, so a later deletion propagates), `ownedPaths()` returns it. A path the projection never laid down is created if the collection is empty there, `converged` if the collection holds the same content, otherwise a `conflict`; it is never deleted or overwritten. Read-only mount paths never enter the baseline. The baseline lasts as long as the projection object, is never persisted, and a resumed session with no baseline owns nothing (`pj:19-33`, `112-113`, `216-220`, `481`; **[test]** `tpj` "owns exactly what it laid down" (54), "a path we hold no baseline for is not ours to delete" (194), "does not claim ownership of a read-only mount's files" (855)).

### W-6: `projection.put(path, content)` (`pj:61-78`, `429-449`)

Decides one path through the same three-way check as a flush. Resolves a `FlushOutcome`, or `undefined` only for a collection's own metadata key (even under a read-only mount). A committed result (`created`, `written`, `converged`) makes the path owned, so a later flush can delete it; `conflict`, `contested`, `readonly` and `orphan` leave it unowned. A path under no mount is `orphan`; under a read-only mount `readonly`. A leading `./` is normalised (`tpj` line 488). **[test]** `tpj` 442-540.

### W-7: Concurrent writers (`cl:1-93`, `pj:226-249`, `381-397`)

- Refusal between concurrent runs: the second writer to claim an entry gets `contested`; nothing is written for it; its file stays in its place to retry; it appears in `report.contested`. A delete is a write and is refused the same way. A path only read unchanged is never claimed (`pj:379-396`; **[test]** `tpj` 698-775, `tcc`).
- `contested` vs `conflict`: contested = another operation is writing now (nothing to compare); conflict = an earlier write, three hashes (`wt:176-186`).
- Arbitration unit: the durable entry (collection + key), not a path: `claimKey(collectionId, entryKey)` (length-framed so no two spell alike); two sessions each writing `artifacts/report.md` are different entries and do not refuse each other, and one collection mounted under two prefixes is refused at construction (W-1) (`cl:47-49`, `tcc` "lets both write a path they only share the spelling of" (225)).
- Id helpers: `principalFromContext(ctx)` reads `{ sessionId, requestId, requestIncarnation, userId, orgId, tenantId }` (`si:26-38`); `collectionIdFor(collection, principal)` = scope + the scope's instance components + pattern (`si:139-148`); `unscopedCollectionId(collection)` (no execution context, e.g. `createBashTool`) = scope + pattern only, which **over-arbitrates** (errs toward refusing: a refusal is reported and retryable, a missed one is a silent overwrite) (`si:164-166`). `collectionIdFor` is "close to the engine's storage key, not equal to it": two flows that isolate the same user's resources from each other share an id and can be told `contested` over a row they do not share (`si:128-138`).
- Refusal scope: a claim lives for **one operation** (one `flush` or `put`), covers reading, comparing and writing, and belongs to the operation, not the projection (a session-scoped workspace is one projection serving every request in the session) (`pj:225-249`). In-process only: two servers writing one collection are not arbitrated (`cl:30-34`).
- `claims` option: a `ClaimRegistry` (`createClaimRegistry()`) scopes arbitration to a subset of projections; omitted, projections share `sharedClaimRegistry` process-wide (`pj:89-97`, `cl:86-93`).

### W-8: Places

`Place` = `read(path): Promise<string | null>`, `write(path, content): Promise<void>`, `list(prefixes): Promise<readonly string[]>`. A place runs no commands (`wt:13-36`).

**`list` must throw when the place cannot be read.** An empty array asserts "readable and empty", which a flush acts on by deleting what it owns (`wt:18-23`, `29-35`). The projection wraps a failing `list` as `PlaceUnreadableError`, thrown by `flush` only; nothing was read or written, so a caller may swallow it; every other flush rejection (a collection read or write) means work did not reach the store (`wt:212-228`, `pj:265-272`; **[test]** `tpj` 370-406, `thp` "leaves the collection intact when the place breaks under it" (85)).

| Place | Behaviour | Cite |
| --- | --- | --- |
| `createHostPlace(root)` | A real directory. Creates `root` if missing; refuses a path resolving outside it (`path escapes the workspace root: <path>`); a symlink at the leaf is refused on read and write (`path is a symlink, which this place does not follow: <path>`, opened with `O_NOFOLLOW`); a symlink in the parent chain is refused when it leads outside the root (`path escapes the workspace root through a symlink`); `list` does not list or follow symlinks, lists a nested-prefix file once, treats a prefix with no directory as empty, and throws if the root itself is gone. Executes nothing | `hp:38-120`, `133-162`, `214-228`; `thp` 103-236 |
| `createMemoryPlace(initial?)` | Files in a map. Adds `snapshot()`, `remove(path)`, `breakListing(reason?)` (makes every later `list` throw) | `mp:12-54` |

A symlink pointing back inside the place is also refused at the leaf (`thp` 214).

### W-9: `recordBranchPullRequests(ctx, options)` (server-side only; `bp:141-217`)

Asks GitHub which pull requests a checkout's branch has and adds them to the session's `observed-pull-requests` collection with `source: "branch"`. GitHub only; uses the signed-in `gh` on the machine, in the repository `gh` resolves from the checkout's remote. Call from a block that runs after the coding step (a request-end hook such as `request: { onFinished }` works), passing that block's context.

| Option | Type | Default / effect | Cite |
| --- | --- | --- | --- |
| `cwd` | string | The checkout whose current branch is checked (skipped when detached) | `bp:47` |
| `branches` | `string[]` | More branches beside the current one (the branch the host made for the session, which the agent may have left) | `bp:53` |
| `requestId` | `string \| null` | The request new rows are stamped with. Default: the context's request id | `bp:55`, `203-204` |
| `openedSince` | number (epoch ms) | Only pull requests GitHub says were created at or after this time, **less a 60-second clock allowance**, are written. Omitted: every pull request in the first **20** GitHub returns per branch (`per_page=20`) | `bp:56-62`, `102-103`, `172`, `194-195` |
| `timeoutMs` | number | Default `BRANCH_PULL_REQUESTS_TIMEOUT_MS` = 30 000. Shared by every `git` and `gh` command the check runs; separate from the turn's abort signal | `bp:42`, `63-64`, `151-153` |
| `gh` | string | The `gh` to run; default `"gh"` on `PATH` | `bp:65` |
| `worktree` | `{ collection, key, startedOn? }` | Also adds what is found to that worktree's list row | `bp:67-74` |

- States: open, closed and merged all come back; recorded as `merged` when `merged_at` is set, `draft` for an open draft, else GitHub's `open`/`closed` (`bp:115-116`). Only branches whose head is in the **same repository** (`head={owner}:<branch>`); not forks (`bp:172`).
- Result (`BranchPullRequestsResult`, `bp:78-80`): `{ status: "recorded", branches: string[], pullRequests: PullRequestRef[] }` or `{ status: "unavailable", reason: string }`. `pullRequests` lists what was found and passed the `openedSince` cut, including ones the session had already recorded. It never throws.
- `unavailable` for: the `observed-pull-requests` collection not registered on the flow (`the "observed-pull-requests" collection is not registered on this flow`), the checkout's branch unreadable, any branch GitHub could not be asked about (one failing branch makes the whole call `unavailable`; `gh` missing or signed out, no GitHub remote, timeout), a failed write (`bp:145-150`, `158-162`, `185-188`, `213-215`; **[test]** `tbp` 129-164). No branch to check (detached, no `branches`) → `recorded` with empty arrays (`bp:164`).
- Row writes (core's `writePullRequests`, `pr:444-492`): a new pull request is written whole with `source`, `firstSeenAt`, the stamped `requestId`; an existing row keeps its `requestId` and `firstSeenAt`, has an empty `url`, `title`, `branch` or `requestId` filled, and has `state` replaced when the sighting names a different one; a `tool` sighting upgrades a `branch` row's `source`. Before writing, the check waits for the request's in-turn recorder to finish, so a pull request seen in a create call keeps `source: "tool"` (`bp:200`).
- Requires the flow to declare `observedPullRequestsCollection` (`@flow-state-dev/core`; the coding-agent blocks do by default) (`pr:98-110`).
- Also exported and not in the routed rows: `readPullRequest(options)`, `pullRequestHead(options)`; they throw `WorkspaceRefusedError` with code `pull-request-unreadable` / `pull-request-from-fork` (`bp:261-369`). Left out of this page unless R-42 plans a "pull request reads" row.

### W-10: Mounting and write-routing, as the bash tool uses it (rows "Mounting and write-routing", "Auto-discovered mounts", "Workspace layout")

Carried in B-4 and B-5. One plain sentence stays on the Concepts page; the rule (longest prefix wins; `tmp/` never persists; anything else dropped with a warning) is B-5.

## Stored parts: owner, who sees it, where it is stored, how many

Bash stores or creates the following; each answered. "Server" = the machine running the flow.

| Part | Owner | Who can see it | Where it is stored | How many | Cite |
| --- | --- | --- | --- | --- | --- |
| File entries synced from a mount (`path`, `hash`, `updatedAt` state, plus `createState` extras; content separate) | the collection's own scope (the collection owns them; bash is a view) | whoever can read that collection; the model through the tools | the resource collection's store | one per file key per collection | `Bt:51-68`, `pj:457-475`, `p-bash:358-377` |
| Local workspace directory | the scope: one request (`run`), session, user or org; tenant segment on `run` and `session` only | any run in that scope; nothing else on the machine is walled off from the server's user | `<process.cwd()>/.fsdev/workspaces/<scope>/<enc-…>/` on the server; with `cwd` set, that directory (one shared by all) | one per scope instance; a `run` directory per request; **never removed** | `Bb:322-325`, `375-386`, `p-bash:285-286` |
| Live sandbox (process) | the process, keyed by scope instance | in-process only | a module-level map; **not persisted**; lost on restart; idle-released after 30 minutes | one per scope instance (per session for every provider but `local`) | `Bb:205-271` |
| `bashSession` singleton (`sandboxId`, `provider`, `lastSyncedAt`, `workingDirectory`) | the resource you pass as `bashSession` (`createBashTool` only) | whoever can read that resource | the resource's own store; written only when `persist: true` and the provider returned an id (Vercel: the sandbox id; MOAT: the run name; local and just-bash return none) | one singleton | `Bt:329-335`, `Bk:91`, `218-226`, `Br:47-69` |
| Projection baseline and claims | the projection / the operation | in-process | memory; discarded at teardown; claims released at the end of each flush or put | one baseline per projection | `pj:28-33`, `242-249` |
| MOAT container and generated `moat.yaml` | the host operator's machine; named per session (or your `runName`, shared) | the operator (`moat list`); the framework process | the container runtime; `moat.yaml` in the workspace; `<os tmpdir>/fsdev-moat/<runName>` | one per session by default; at most 50 `fsdev-*` runs kept, oldest destroyed on a cold start | `mo:793-856`, `1286-1367` |
| Pull-request rows | the session (`scope: "session"`) | the session's client (readable; not writable by it) | `observed-pull-requests/**`, lazy | one per pull request (key from host/owner/repo/number) | `pr:98-110`, `bp:200-206` |
| MCP connections and catalog | the `createMcpManager` instance (one per `createMcpCapability({ servers })` call) | in-process; `getServerConfigs()` exposes headers (never log) | memory; `close()` clears | one connection per server | `manager.ts:145-256`, `types.ts:103-107` |

Search, fetch and crawl store nothing; results are returned in the tool call. (Whether a tool call's input and output are recorded by the framework is a framework behaviour, not on this page.)

## Rows not carried, and rows corrected

Each routed row was checked. Rows I carried unchanged are not listed. Dropped or corrected:

1. **Fetch providers row, "renders with a 5000 ms wait when `waitForJS`"**: true for Firecrawl; carried. The row's Jina line ("rendering ... not configurable here") is carried and sharpened: Jina never reads `waitForJS` (`jina.ts`).
2. **"20 RPM" keyless Jina limit**: not in the code, not in a test; both existing pages state it as fact. **Dropped** (a third party's limit, not checkable here). Rows R-15 or elsewhere should not repeat it without a source.
3. **`entryState` "applied last so it can override"**: **false**; corrected in W-1 (the projection's `path`/`hash`/`updatedAt` win; the field is for extra state).
4. **Workspace scope fallback row ("`org` uses the session workspace when it carries no `orgId`")**: carried and true; the existing `p-bash:300` ("always has an organization") is the thing that is wrong.
5. **`orphan` ("a file written outside every writable mount")**: narrowed in W-3 (under no mount at all; from `put`; from `flush` only inside a mount prefix nothing owns; the bash layer adds a root-level scan).
6. **`maxPages` / `maxDepth` "set by both"** (row "Options table column 'set by'"): **corrected** in K-1: set by the call only; the config value is declared but does not apply. Same for search `maxResults` and `topic` (S-2).
7. **Search output row ("`answer` is returned by Tavily and Perplexity Sonar")**: carried; **Serper also sets `answer`** (`serper.ts:54`), added in S-6.
8. **Upstash row, "Vercel and Upstash adapters: SDK is passed in by the consumer; how to pass the Sandbox class"**: Vercel carried; **Upstash is not implemented** (throws), so only the placeholder fact is carried (B-3).
9. **MOAT "provider options table: runtime, runName, grants, allowHosts, configPath, execTimeoutMs, persist"**: incomplete; the code also has `workspace`, `mountTarget`, `noSandbox`, `bin` (MOAT-3).
10. **MOAT cold-start and image-build timings**: kept as approximate figures quoted from the code's own comments (no test pins them); the only enforced number is the 60 s readiness deadline.
11. **"Cleanup required for MOAT"** (existing `p-bash:212`, README `readme:251`): contradicted by the carried row (optional everywhere) and by the idle release (B-6).
12. **Crawl "Firecrawl filter syntax: regex"**: the adapter passes strings to Firecrawl unchanged; "regex" is stated only on `p-crawl:17` **[doc]**. Carried as a doc claim, not a code fact.
13. **"Crawl errors: a failed crawl call with Firecrawl throws"**: the adapter has no failure check; what throws is whatever the SDK throws (K-4). Carried in that wording.
14. **"Opening is the model (one tool, one normalized shape, any provider). No row."**: not a claim; no row.
15. **"Generator `search` versus `tools.search`" first paragraph**: stays in the note for the page; carried in S-8 as differences only.
16. **"Workforce coding-run relay sentence"**, **"Provider selection ... passing `keys` explicitly"**, **"MCP migration-off-SSE remark"**: sentences, not rows; the third is cut.
17. **Workspace-package rows that sit under other surfaces** (the workspace host, worktree list, land, source read, `readPullRequest`, `pullRequestHead`): not among the routed rows; not carried beyond a mention in W-9.

## Contradictions between code and existing pages (for the writer)

| Existing page says | Code says | Where |
| --- | --- | --- |
| `maxPages`/`maxDepth` in config are defaults the model can override (`p-crawl:45-47`, `69-70`; `p-over:54`) | The call's schema defaults (20, 2) win; the config values never apply | K-1 |
| Jina renders JS with `waitForJS` (`p-fetch:46`, `18`) | `waitForJS` is Firecrawl-only | F-1 |
| Jina works at 20 RPM with no key (`p-fetch:111`, `p-over:72`) | Not in code; dropped | rows 2 |
| `description` appears in tool descriptions under `enrichDescriptions: "category"` (`p-mcp:61`) | Only the server name and category | MCP-2 |
| An `org` workspace always has an organization (`p-bash:300`) | Falls back to the session | B-4 |
| `entryState` "applied last, so it can override" (`p-ws:58`) | The projection's three fields always win | W-1 |
| "Seed `./tmp/.keep`" (`p-bash:307`) | The marker is `.fsdev-keep`, under `tmp/` and each mount | B-5 |
| `just-bash` fallback: "in-memory Map-based sandbox" is "always available" (`p-over:20`, `p-bash:386`) | It runs no commands | T-1, B-3 |
| `createBashTool` writes flush after `bash` and `writeFile` (`Bk:59` doc comment) | `writeFile` commits that one path; only `bash` flushes | B-2 |
| `p-fetch:137` lists six errorTypes | Seven: `blocked` | F-6 |
| MOAT cleanup "required" (`p-bash:212`) | optional | B-6 |
| `orphan` = file outside every writable mount (`p-ws:71`) | Narrower | W-3 |
| `p-search:261-267` shows `answer` as grounding providers only | Also Tavily and Serper | S-6 |

## Open points for the writer

- No keyed example exists under `examples/` or `labs/` that I read; the existing pages' code examples are the sources for each tool's call shape. A kitchen-sink capability `apps/kitchen-sink/flows/chat-agent/shared/capabilities/bash.ts` is named on `p-bash:128`; I did not read it.
- Numbers I could not source from code or tests (left off): the Jina keyless rate limit; the MOAT "10–30 s" and "30–60 s" timings beyond the code comments.

## Draft notes (pass 3)

Routed rows dropped or reduced when drafting, and why:

- Jina keyless "20 RPM": unsourced in code, dropped (see row 2 above).
- `entryState` "applied last so it can override": false, page states the projection's fields win.
- Provider HTTP endpoints, the full non-public IP range table, `readPullRequest` and `pullRequestHead`, the workspace host, worktree list and land surface: implementation or outside the routed rows, left off.
- The Workforce coding-run relay sentence and the SSE migration remark: not table rows; the first is a link elsewhere, the second is cut.
- Open-question points: "robots.txt is not read" and "does not render JavaScript" are carried as stated limits from K-4.
- No figure: the entry briefs none, and a reference page is tables.

## Revise round 1

- `moat list --json` is the command the adapter runs (`mo:655`, `821`); `moat ls` was wrong and is corrected in the stored-parts row above.
- Node `>=22` is the package's `engines` (`pkg:91-93`), so the page states it for the package, not for the built-in reader.
- Firecrawl crawl: the adapter reads `result.data ?? []` and never looks at a success flag (`Kf:23-41`), so a result with no data returns `pages: []`; SDK errors propagate.
- Refusal and log strings use an em dash where the page earlier showed a comma (`Bp:179,182,189`, `Bb:564`). They sit in inline code, which the em-dash count skips.
- Moved off the page to R-27 (`harness-runs`) as rows, source kept here in W-9: `recordBranchPullRequests` options, results, state mapping, row-merge rules and the "Pull-request rows" stored-parts line (`observed-pull-requests/**`, owner the session, read only by the client, one per pull request). Corrections the R-27 row must carry: a pull request the coding tool already recorded in this request keeps `source: "tool"`; the Claude Code, Codex and Cursor blocks declare the collection by default (`recordPullRequests`, default `true`).
- Moved to R-02 (`generators`): the generator `search` option and `searchDepth` values `low`, `medium`, `high` mapped to OpenAI's `searchContextSize` (S-8). The page keeps one line telling it apart from `tools.search`.
- Workspace rows (mount, routing, outcomes, concurrent writers, places) stay on this page; the `FlowError` shape stays on R-22 with only the fetch code table here.
- Reworded: `collectionIdFor` ids are shared by two different flows whose collections have the same scope, scope instance and pattern, so either can be told `contested` (W-7); the local host runs commands with no call to a remote sandbox service.
