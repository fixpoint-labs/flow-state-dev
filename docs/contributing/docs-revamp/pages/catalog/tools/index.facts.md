# Facts for Tools (K-29, catalog)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on a Reference or sub-page; the page links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[contradiction]** code and the existing page disagree; the code wins.

Abbreviations: `ix` = `packages/tools/src/index.ts` · `sr` = `packages/tools/src/search/resolver.ts` · `si` = `packages/tools/src/search/index.ts` · `fr` = `packages/tools/src/fetch/resolver.ts` · `fi` = `packages/tools/src/fetch/index.ts` · `cr` = `packages/tools/src/crawl/resolver.ts` · `ci` = `packages/tools/src/crawl/index.ts` · `bt` = `packages/tools/src/bash/create-bash-tool.ts` · `bc` = `packages/tools/src/bash/capability.ts` · `pj` = `packages/tools/package.json` · `ov` = `apps/docs/docs/tools/overview.md` (the page this one keeps) · `gen` = `packages/core/src/blocks/generator.ts` · `st` = `packages/tools/test/search.test.ts` · `rt` = `packages/tools/test/resolver.test.ts`.

## Flags against the page plan (read first)

1. **The package ships more than the plan's table assumes, and one tool is not a generator `tools` entry.** The kept page's table lists four: `tools.search()`, `tools.fetch()`, `tools.crawl()`, `createBashTool()` (`ov` table). `createBashTool` is **not** a block. It is `async`, returns `{ tools, sandbox }` of AI SDK tool objects, and those go to a generator's `providerTools`, not `tools` (`bt:1-24`, `bt:63-65`). The block form is `createBashCapability` (`bc:209`), wired with `uses: [bashCap]`, whose `tools` preset holds three handler blocks `bashCommand`, `bashReadFile`, `bashWriteFile` (`bc:203-224`). So the kept page's row and "pass tools to a generator's `tools` array" are wrong for bash. **[contradiction]** The page's `tools: [search, fetch]` example is correct for search, fetch, crawl only (`si:38`, `fi:19`, `ci:19`, `gen:613`).
2. **Two more shipped surfaces are not in the kept table.** MCP: `createMcpCapability` from `@flow-state-dev/tools/mcp` (`packages/tools/src/mcp/index.ts:7`, `pj` exports `./mcp`), wired with `uses`. Bash capability: above. Existing sub-pages: `apps/docs/docs/tools/{search,fetch,crawl,bash,mcp}.md`. The revamp's drafts of them are `docs/contributing/docs-revamp/pages/catalog/tools/{search,fetch,crawl,bash,mcp}.md`. **[page]** (rows, linking each).
3. **Not in this package:** workspace projection is `@flow-state-dev/workspace` (`apps/docs/docs/tools/workspace.md`; imported by `bt:38`), and the coding-agent harnesses are their own packages (`ov` Next steps). The plan's table is "the tool blocks that ship"; the sheet treats them as links, not rows. **[ref]**
4. **Stored data.** The page stores nothing. The four questions do not apply to the tools themselves. The bash tool's synced files belong to resource collections the app declares; that is the Bash page's subject. **[ref]**
5. **The kept overview's prose says "All three tools follow the same pattern"** (`ov`, "Provider auto-selection") after a table of four. Search, fetch and crawl have providers; bash has a sandbox `provider` option of a different kind (`bt:69`, `bc:212`). **[contradiction]** minor; do not carry the sentence.

## 1. What ships

- Package: `@flow-state-dev/tools`, "Reusable tool blocks for flow-state-dev." `pj:3`. README: "Portable tool blocks ... Each tool is a handler block that can be passed directly to a generator's `tools` array." `packages/tools/README.md:3`. **[page]**
- Import surface: the root exports `tools = { search, fetch, crawl, createBashTool }` and each of `search`, `fetch`, `crawl`, `createBashTool` by name. `ix:5-14`. Subpath exports `./search`, `./fetch`, `./crawl`, `./bash`, `./mcp`. `pj` exports map. **[page]**
- `search(config?)`, `fetch(config?)`, `crawl(config?)` each return a block built with `handler()` from `@flow-state-dev/core`, named `"search"`, `"fetch"`, `"crawl"`. `si:38-39`, `fi:19-20`, `ci:19-20`. The test asserts `kind === "handler"` and `name === "search"`, and that `tools.search()` is the same kind of definition. `st:134-147`. **[page]**
- What each does, from its own description and schemas:
  - search: "Search the web for information. Returns titles, URLs, and snippets from web pages matching the query." `si:40-41`. Input `{ query, maxResults (default 5), topic: "general" | "news" (default "general") }`. `search/types.ts:44-54`. **[page]**
  - fetch: "Fetch a web page and return its content as markdown." Input `{ url }`. Output carries `url`, `title`, `markdown`, `metadata`, `source`. `fi:21-24`, `fetch/types.ts:10-32`. **[page]**
  - crawl: "Crawl a website starting from a root URL, following links up to a specified depth. Returns markdown content for each page found." Input `{ url, maxPages (default 20), maxDepth (default 2) }`. `ci:21-24`, `crawl/types.ts:23-33`. **[page]** (the kept page's `maxPages: 30, maxDepth: 2` config example is valid: `ci:29-30` takes config as the fallback to the model's input.)
  - bash: runs commands in a sandbox and syncs files with resource collections; entry point `createBashTool(options)` returns tools `bash`, `readFile`, `writeFile`. `bt:1-24`. The capability form `createBashCapability` returns a capability whose `tools` preset is three handler blocks. `bc:203-224`. **[page]** (one row; detail is the Bash page)
  - MCP: `createMcpCapability` connects MCP servers and exposes their tools to a generator; requires the optional peer `@ai-sdk/mcp`. `packages/tools/src/mcp/index.ts:1-7`, `pj` peerDependencies. **[page]** (one row; detail is the MCP page)

## 2. Giving one to a generator

- A generator's `tools` slot takes an array of blocks, or a function returning one: `tools?: GeneratorTool[] | ((input, ctx) => MaybePromise<GeneratorTool[]>)`, and `GeneratorTool = BlockDefinition<any, any>`. `gen:613`, `gen:422`. So a shipped tool and a block you write are the same type there. **[page]** (answers question 3)
- Example that fits: `generator({ name, model, prompt, tools: [tools.search(), tools.fetch()] })`. Kept page, "Using tools in generators". `ov`. Model name: use `openai/gpt-6-luna` on the revamped page (style standard); the kept page's `anthropic/claude-sonnet-5-5` is not wrong but is not the house name. **[page]**
- The model decides when to call a tool during a conversation; the framework runs the tool-call loop. `ov` "What are tools?". The tool's description and input schema are what the model is shown: `description` is passed in `handler({ ... description, inputSchema })` for each (`si:38-42`, `fi:19-24`, `ci:19-24`). **[page]**
- A shipped tool is the same kind of block as one you write: each is `handler({ name, description, inputSchema, outputSchema, execute })`. `si:38-58`; the same shape the kept page uses for its own `readArtifact` handler. `ov` "Marking tools cacheable". Differences you can observe: none in kind (`st:134-147` asserts `kind === "handler"`). What a shipped one adds is a provider chosen from your keys (section 3). **[page]**
- Bash does not go in `tools:`. Capability form: `uses: [bashCap]` on a generator (`bc:209`; `apps/docs/docs/tools/bash.md` "Recommended path"). Raw form: `providerTools: [providerTool("bash", tools.bash), ...]` (`bt:15-23`). **[page]** (one sentence and a link; the page must not put `createBashTool()` in a `tools: [...]` array)
- MCP also goes through `uses`. `packages/tools/src/mcp/index.ts:1-7`. **[page]**
- A tool can be marked `cacheable` on its block config; that is a block option, not a shipped-tool option, and the kept page's section on it is about blocks you write. `ov` "Marking tools cacheable". **[ref]** (belongs on the Task Board / flow policy pages; the K-29 plan lists no cache section)
- Provider-native search is a different thing: a generator's own `search` option, which `tools.search` is "distinct from". `gen:614-618`; `packages/tools/README.md` ("`tools.search` is distinct from the generator's built-in `search` option"). Answers the page's question 1 only in part: the model's built-in search needs no key from this package; `tools.search()` does. **[page]** (one sentence, link to Generators)

## 3. Provider keys

- Search needs a key; there is no keyless fallback. With no key, `resolveProvider` throws "No search provider available. Configure at least one of: ... or pass keys explicitly via search({ keys: { tavily: '...' } })". `sr:64-68`. The throw happens when the tool runs, not when `search()` is called: `search()` with no keys returns a block, and running it rejects with "No search provider available". `st:242-252`. **[page]**
- Search environment variables: `TAVILY_API_KEY`, `EXA_API_KEY`, `PERPLEXITY_API_KEY`, `SERPER_API_KEY`, `BRAVE_SEARCH_API_KEY`, `PARALLEL_API_KEY`; `perplexity-sonar` uses `PERPLEXITY_API_KEY` too. `sr:19-27`. **[page]**
- Auto-selection picks the first keyed provider in order Parallel, Tavily, Exa, Perplexity, Serper, Brave, Perplexity Sonar. `sr:9-17`, `si:18`; test: "prefers parallel over other providers when multiple keys are set" `rt:142`. **[page]** (one sentence; order detail is Search)
  - **[contradiction]** `rt:86-97` names the group "selects tavily first when multiple keys are available" but `sr:9-17` and `rt:142` put Parallel first; the README table (`packages/tools/README.md`, Providers) also lists Parallel first. The code wins: Parallel first.
- A `tier` request can skip a provider: `deep` skips Serper and Brave, which have no deep mode. `sr:44-53`; `packages/tools/README.md` ("a `deep` request routes past them"); `rt:162-172`. **[ref]** (Search page)
- Keys can be passed instead of read from env: `search({ keys: { tavily: "..." } })`; config key wins over env. `sr:75`, `rt:47`. Same for fetch (`keys.firecrawl`, `keys.jina`, `fr:51-57`) and crawl (`keys.firecrawl`, `cr:44-45`). **[page]**
- Forcing a provider: `tavilySearch`, `exaSearch`, `serperSearch`, `braveSearch`, `parallelSearch`, `perplexitySearch`, `perplexitySonarSearch` (`si:62-88`); `firecrawlFetch`, `jinaFetch`, `builtinFetch` (`fi:37-47`); `firecrawlCrawl`, `builtinCrawl` (`ci:41-47`). A forced provider with no key throws: `Search provider "X" requested but no API key found. Set ... or pass it via config.keys.X`. `sr:33-40`, `fr:23-28`, `cr:22-27`. **[page]** (one line; the names are the Search, Fetch and Crawl pages')
- Fetch needs no key: auto-selection is Firecrawl (with `FIRECRAWL_API_KEY`), then Jina (with `JINA_API_KEY`), then a built-in fetch plus Readability plus Turndown. `fr:32-45`, `fi:12-16`. Forced `jinaFetch` works without a key (`fr:23`; kept page: "works without key at 20 RPM"). **[page]**
- Crawl needs no key: Firecrawl if `FIRECRAWL_API_KEY` is set, otherwise the built-in breadth-first crawler. `cr:30-37`, `ci:14-16`. **[page]**
- Optional peer dependencies, installed only for the providers you use: `@tavily/core` (Tavily), `exa-js` (Exa), `@mendable/firecrawl-js` (Firecrawl fetch and crawl), `just-bash` (bash default sandbox), `@ai-sdk/mcp` (MCP). `pj:105-126`. Parallel, Perplexity, Serper and Brave are fetch-based and need no extra package. `packages/tools/README.md` Providers table. Missing package errors read "Install @tavily/core to use the Tavily search provider: npm install @tavily/core". `search/providers/tavily.ts:20`, `exa.ts:28`, `fetch/providers/firecrawl.ts:13`. **[page]** (the install line; the table of which package is [ref])
- Bash has no key. Its default provider is `just-bash` (`bt:69`, `bc:212`), an in-memory sandbox, loaded by dynamic import (`bash/resolve-sandbox.ts:56-57`) and an optional peer (`pj:125-127`). **[contradiction]** the kept page says "in-memory fallback always available"; it holds only when `just-bash` is installed, which is optional. The sheet cannot say what error a missing `just-bash` raises (not read). **[gap]** for the error text; **[page]** may say bash needs no key, and links Bash for providers.
- Install: `pnpm add @flow-state-dev/tools` (`packages/tools/README.md`, Installation); kept page uses `npm install`. Pick the package manager the rest of the revamp uses. **[page]**

## 4. Direct answers to the plan's questions

1. **How does a generator get web search?** Add `tools.search()` (with at least one provider key set) to its `tools` array; the model calls it and gets `{ query, results[], answer? }` of titles, URLs, snippets (section 1; `search/types.ts`, mock output `st:21-33`). Separately, a generator has a provider-native `search` option that needs nothing from this package (`gen:614-618`). **[page]**
2. **Which tools need a provider key?** Only search. Fetch and crawl work with none and improve with a Firecrawl key (and Jina for fetch). Bash and MCP take no key from this package; an MCP server may carry its own, which is the MCP page's. `sr:64-68`, `fr:43-44`, `cr:36-37`. **[page]**
3. **Is a shipped tool different from a block you write?** No. `search`, `fetch`, `crawl` are `handler()` blocks and the `tools` slot takes any block (`gen:422`, `gen:613`, `st:134-141`). Bash and MCP are the exceptions in how they attach: through `uses` or `providerTools`, not `tools`. **[page]**

## 5. Not stated (limits of the sheet)

- No claim about what the tools cost, rate limits (beyond the kept page's "20 RPM" Jina line), result ordering or quality. **[gap]**
- No `goals/` check or example under `examples/`/`labs/` was found that runs `tools.search` in a generator end to end; the only evidence for generator use is the generator's slot type and the tool unit tests. **[gap]** Verify the page's example type-checks before pass 4.
- Retired wording to avoid on the page: "the LLM" is fine; use "user", not "person". Page title and frontmatter: `type: catalog`, 500 words (K-29).

## 6. Revise round 1 corrections

- The table row for bash is `createBashCapability()` (the `uses` form, `bc:209`), not `createBashTool()`; it needs the optional peer `just-bash` (`pj:105-126`, `bt:50,69`). MCP row added: `createMcpCapability()`, optional peer `@ai-sdk/mcp`. **[page]**
- Jina: auto-selection uses it only when a Jina key is found (`fr:39-42`); keyless Jina needs the provider forced (`fr:23`). The "20 RPM" figure has no source in code and is not stated. **[gap]**
- `cacheable` applies to any block in a generator's `tools` slot when a tool cache is installed via `createToolCacheCapability` in `uses` (`packages/core/src/blocks/tool-cache.ts:189-200`, `packages/core/src/types/block.ts:1136-1144`); a task board installs one when a worker tool declares `cacheable` (`packages/orchestration/src/task-board/index.ts:526-529`). No effect outside a generator's tool slot. Errors never cached. **[page]** Single-flight coalescing and the scope table's detail are **[ref]**. The page's example is self-contained (no `ctx.resources`) and type-checks.
- `@flow-state-dev/workspace` exists (`packages/workspace/package.json`, version 0.4.0); the page no longer links it. The `fetch` and `crawl` built-in fetcher is described as "returns markdown"; library names are not on the page.

## 7. Revise round 2 corrections

- Cache scope outside a task board: `run` and `request` both key entries by the request id, and the store is per request (`packages/core/src/blocks/internal/cache-tool-call.ts:178-195`, `packages/core/src/blocks/tool-cache.ts:221-240`). So on a generator with `createToolCacheCapability()` in `uses`, `run` behaves like `request`; on a task board the store is rebound per board run (`tool-cache.ts:267-284`). `session` keys by session id. **[page]**
- MCP page exists at `/docs/tools/mcp`; the page links it inline and in Next steps.

## 8. Revise round 3 corrections

- Page now states the search auto-selection order (Parallel, Tavily, Exa, Perplexity, Serper, Brave, Perplexity Sonar; `sr:9-17`, `rt:142`) and that Parallel beats Tavily when both env keys are set. **[page]**
- Forcing a provider is the factory (`tavilySearch`, `si:62-88`; `firecrawlFetch`, `fi:37-47`); a config key wins over env (`sr:75`, `rt:47`); a forced provider with no key throws (`sr:33-40`). **[page]**
- `tools.search({ keys })` alone does not force a provider: the order still applies (`sr:9-17`). **[page]**
- Optional peers (`@tavily/core`, `exa-js`, `@mendable/firecrawl-js`; `pj:105-126`); missing-package error `Install @tavily/core to use the Tavily search provider` (`tavily.ts:20`). **[page]**
