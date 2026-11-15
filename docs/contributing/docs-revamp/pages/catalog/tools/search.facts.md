# Fact sheet: Search (K-30, `catalog/tools/search`)

Sources cited: the exported surface and doc comments in `packages/tools/src/search/`, its test
`packages/tools/test/search.test.ts`, the existing user docs (`apps/docs/docs/tools/search.md`,
`apps/docs/docs/tools/overview.md`, `apps/docs/docs/fundamentals/blocks.md`, `packages/tools/README.md`),
and two examples (`apps/kitchen-sink/...`). Paths are relative to the repo root; `S/` abbreviates
`packages/tools/src/search/`. No spec is cited.

## Stored data: the four questions

The tool stores nothing. It holds no resource, collection, state or session data of its own, and each
call is one HTTP request (or SDK call) to the provider. Owner, visibility, location and count do not
apply. (The only things that persist are the block call's own recorded input and output, which the
framework records for every block; that is not Search's to document.) The API keys live in the host's
environment variables or in the config object you pass, never in framework state.
Evidence: `S/index.ts:38-58` (the whole `execute`), `S/resolver.ts:71-76` (keys read from config or
`process.env`).

## What it is

- F1. `search` is a handler block, named `search`, built for use in a generator's `tools` list.
  `S/index.ts:14-15,38-39`; `packages/tools/test/search.test.ts:134-140` (`name` is `"search"`, `kind` is `"handler"`).
- F2. Its model-facing description is "Search the web for information. Returns titles, URLs, and
  snippets from web pages matching the query." `S/index.ts:40-41`.
- F3. It is reachable as `tools.search(...)` from `@flow-state-dev/tools`, as `search` from the same
  package, and as `search` from the subpath `@flow-state-dev/tools/search`. `packages/tools/src/index.ts:6,8`;
  `packages/tools/package.json:34-37`; example import `apps/kitchen-sink/workforce/teams/support/workers/fsd/blocks/search-docs.ts:11`.
  `tools.search()` and `search()` return the same kind of block. `packages/tools/test/search.test.ts:142-147`.
- F4. One interface across seven providers: `tavily`, `exa`, `perplexity`, `serper`, `brave`,
  `parallel`, `perplexity-sonar`. `S/types.ts:5` (`searchProviders`).
- F5. The block takes the config at build time, so a call with no argument is valid: `search(config: SearchConfig = {})`. `S/index.ts:23`.
- F6. The block can be renamed and re-described with `.as({ name, description })`; the kitchen-sink
  example does so to give the model a more specific tool. `apps/kitchen-sink/workforce/teams/support/workers/fsd/blocks/search-docs.ts:16-20`.
  (Only the call is shown in a citable example; `.as` lives on the block builder in core, not in the tools package.)

## Which provider is used when you name none (sitemap question 1)

- F7. With no `provider`, the tool checks each provider's key in this order and takes the first with a
  key: Parallel, Tavily, Exa, Perplexity, Serper, Brave, Perplexity Sonar. `S/resolver.ts:9-17` is
  `providerPriority`, loop at `S/resolver.ts:48-54`.
  Same order in the JSDoc: `S/index.ts:18`.
- F8. A key is read from `config.keys[<provider>]` first, then from the provider's environment
  variable. `S/resolver.ts:71-76`.
- F9. Environment variables: Tavily `TAVILY_API_KEY`, Exa `EXA_API_KEY`, Perplexity
  `PERPLEXITY_API_KEY`, Serper `SERPER_API_KEY`, Brave `BRAVE_SEARCH_API_KEY`, Parallel
  `PARALLEL_API_KEY`, Perplexity Sonar `PERPLEXITY_API_KEY`. `S/resolver.ts:19-27`.
- F10. Perplexity and Perplexity Sonar share one variable. Because Perplexity sits earlier in the order,
  setting `PERPLEXITY_API_KEY` alone selects Perplexity, never Sonar. Sonar is reached by
  `provider: "perplexity-sonar"`, `perplexitySonarSearch()`, or a key passed as `keys["perplexity-sonar"]`
  with no earlier provider keyed. `S/resolver.ts:9-27`; `packages/tools/README.md` ("When
  `PERPLEXITY_API_KEY` is set, auto-detection prefers the Search API").
- F11. Auto-selection is tier-aware. It takes the first keyed provider (in priority order) whose
  supported tiers include the requested tier. If none qualifies, it takes the first keyed provider
  regardless of tier. `S/resolver.ts:44-62`.
- F12. Supported tiers: Parallel, Tavily, Exa, Perplexity and Perplexity Sonar serve `fast`,
  `balanced`, `deep`. Serper and Brave serve only `fast` and `balanced`. So with `tier: "deep"`, a
  keyed Serper or Brave is skipped for any other keyed provider. `S/providers/tavily.ts:13`,
  `exa.ts:21`, `perplexity.ts:20`, `perplexity-sonar.ts:22`, `parallel.ts:27`, `serper.ts:15`, `brave.ts:15`.
- F13. With `provider` set, no auto-selection happens. If that provider has no key, the call throws:
  `Search provider "<name>" requested but no API key found. Set <ENV_VAR> or pass it via config.keys.<name>`.
  `S/resolver.ts:32-41`; `packages/tools/test/search.test.ts:330-338`.
- F14. With no provider key anywhere, the call throws `No search provider available. Configure at
  least one of: <all env vars> — or pass keys explicitly via search({ keys: { tavily: '...' } })`.
  `S/resolver.ts:64-69`; `packages/tools/test/search.test.ts:242-251`.
- F15. The error is thrown when the tool runs, not when it is built. `search()` with no keys builds
  without error. `packages/tools/test/search.test.ts:242-251` ("lazy"); `S/index.ts:46`.
- F16. There is no built-in fallback for search; `fetch` and `crawl` have one. `apps/docs/docs/tools/overview.md:74`.
- F17. `tavilySearch`, `exaSearch`, `serperSearch`, `braveSearch`, `parallelSearch`,
  `perplexitySearch`, `perplexitySonarSearch` each accept `SearchConfig` minus `provider` and return
  `search({ ...config, provider })`. `S/index.ts:62-88`; tests `packages/tools/test/search.test.ts:254-338`.
- F18. Two providers need an optional peer package: Tavily needs `@tavily/core`, Exa needs `exa-js`.
  If it is not installed, the call throws `Install @tavily/core to use the Tavily search provider: npm
  install @tavily/core` or `Install exa-js to use the Exa search provider: npm install exa-js`.
  `S/providers/tavily.ts:15-22`, `S/providers/exa.ts:23-30`; `packages/tools/package.json:105-121`.
  The other five use `fetch` with no extra dependency. `S/providers/{parallel,perplexity,perplexity-sonar,serper,brave}.ts`.
- F19. Provider HTTP failures throw `<Provider> API error: <status> <statusText>`
  (Perplexity: `Perplexity Search API error:`; Sonar: `Perplexity Sonar API error:`; Serper; Brave;
  Parallel appends ` — <body>`). `S/providers/perplexity.ts:45-49`, `perplexity-sonar.ts:47-51`,
  `serper.ts:36-40`, `brave.ts:33-37`, `parallel.ts:64-69`.

## What the model sends (the tool's input)

- F20. Input fields the model supplies: `query` (string, "The search query to execute"), `maxResults`
  (number, default 5, "Maximum number of results to return"), `topic` (`"general"` or `"news"`,
  default `"general"`). `S/types.ts:44-54`.
- F21. `maxResults` and `topic` are read from the model's input. The `maxResults` and `topic` keys on
  `SearchConfig` are not read by `execute`; setting them changes nothing. `S/index.ts:47-55` passes
  `input.maxResults` and `input.topic`; `config.maxResults` and `config.topic` appear nowhere in
  `S/index.ts`, `S/resolver.ts` or the adapters. **Contradiction to flag:** `packages/tools/README.md`
  (Configuration block) lists `maxResults: 10` and `topic: "news"` as working config, and
  `S/types.ts:62-63,92-93` documents both. The code wins; the page must not tell a reader to set
  them. (Report this to the caller.)
- F22. `tier` is not an input field by default. A `tier` the model sends is stripped by the schema and
  the config's tier wins. `packages/tools/test/search.test.ts:195-208`; `S/index.ts:27-36,45`.

## Depth tiers

- F23. `tier` is `"fast" | "balanced" | "deep"`, default `"balanced"`. `S/types.ts:17`; `S/index.ts:24`.
- F24. With `agentControlsTier: true`, `tier` becomes a tool parameter with default equal to the config
  `tier` (or `balanced`), described to the model as: "How thorough vs. fast the search should be:
  'fast' for quick lookups, 'balanced' for most queries, 'deep' for thorough research. Use 'deep' when
  the user asks for in-depth, comprehensive, or research-grade results." The model's choice is used.
  `S/index.ts:27-36,45`; tests `packages/tools/test/search.test.ts:210-240` (model picks `deep`; when
  it omits the field the config `tier` applies, shown with `tier: "fast"`).
- F25. Mapping per provider:
  - Exa: `type` = `fast` / `auto` / `deep`. `S/providers/exa.ts:13-17`.
  - Tavily: `advanced` depth for `deep`, `basic` otherwise; also `advanced` whenever
    `searchDepth: "advanced"`. `S/providers/tavily.ts:27-30`.
  - Perplexity: `search_context_size` `low` for `fast`, `high` for `deep`, field omitted for
    `balanced`. `S/providers/perplexity.ts:22-25`.
  - Perplexity Sonar: model `sonar-reasoning` for `deep`, `sonar` otherwise (fast and balanced both
    `sonar`). `S/providers/perplexity-sonar.ts:25-27`.
  - Parallel: `mode` `basic` for `fast`, `advanced` for `balanced` and `deep`. `S/providers/parallel.ts:19-23`.
  - Serper, Brave: no effect. `S/providers/serper.ts:4-11`, `brave.ts:4-11`.
- F26. `searchMode` (string) replaces the tier mapping and goes to the provider verbatim, for Exa
  (`type`), Parallel (`mode`) and Perplexity Sonar (model name). Other providers ignore it.
  `S/types.ts:67-74`; `S/providers/exa.ts:34-35`, `parallel.ts:29-30`, `perplexity-sonar.ts:24-27`.
  Example values the JSDoc gives for Exa: `neural`, `instant`, `deep-reasoning`. `S/types.ts:71-72`.
  The example `search({ provider: "exa", searchMode: "neural" })` is in `apps/docs/docs/tools/search.md` and
  type-checks against `SearchConfig` (`S/types.ts:60-96`).
- F27. `searchDepth` (`"basic"` default, or `"advanced"`) is separate from `tier`. It sets how much
  content each result carries: Exa returns `content` (full text) only when `advanced`, else a
  500-character text request; Parallel sizes excerpts at 6000 characters when `advanced`, 1500
  otherwise; Tavily goes to `advanced` depth. `S/index.ts:49`; `S/providers/exa.ts:39-42,58-61`;
  `S/providers/parallel.ts:52-54`; `S/providers/tavily.ts:27-30`.
  `searchDepth` is config only; the model cannot set it. `S/types.ts:44-54`.
- F28. A tier means nothing on a provider with no knob, so `tier` there is silently ignored (no error).
  `S/types.ts:13-16`.

## Domain filters (sitemap question 2)

- F29. `includeDomains` and `excludeDomains` are string arrays on the config. They are config only; the
  model cannot set them. `S/types.ts:88-91`; `S/index.ts:52-53`.
- F30. How each provider applies them:
  - Exa: `includeDomains` / `excludeDomains` fields. `S/providers/exa.ts:44-49`.
  - Tavily: `includeDomains` / `excludeDomains` fields. `S/providers/tavily.ts:36-41`.
  - Parallel: `source_policy.include_domains` / `exclude_domains`, sent only when set. `S/providers/parallel.ts:31-36,57-59`.
  - Perplexity and Sonar: `search_domain_filter`. `S/providers/perplexity.ts:25,37-39`;
    `perplexity-sonar.ts:28,40-42`.
  - Serper and Brave: written into the query text as `site:domain` and `-site:domain`. Several include
    domains become one OR group, `(site:a OR site:b)`; excludes are chained. `S/providers/domain-filters.ts:6-27`;
    `serper.ts:25`; `brave.ts:18`.
- F31. Perplexity and Sonar take an allowlist or a denylist, not both. With any `includeDomains`, only
  the include list is sent and `excludeDomains` is dropped, so an excluded subdomain of an included
  domain can still appear. With only `excludeDomains`, each is sent `-`-prefixed. `S/providers/domain-filters.ts:29-42`.
- F32. Filter forwarding is tested: `includeDomains: ["arxiv.org"]` and `tier: "deep"` reach the
  adapter. `packages/tools/test/search.test.ts:173-193`. Example in use: `search({ includeDomains: ["flow-state.dev"] })`,
  `apps/kitchen-sink/workforce/teams/support/workers/fsd/blocks/search-docs.ts:14-16`.
- F33. The JSDoc says "where the provider supports it"; every one of the seven providers applies
  them (see F30). `S/types.ts:88-91`.
- F34. Domain strings are used as given (no validation, no normalization of `https://` or paths). Not
  stated on the page unless the writer needs a "pass bare hostnames" rule; the example values are
  bare hostnames. `S/providers/domain-filters.ts:17,24`.

## What comes back (sitemap question 3)

- F35. Output is `{ query: string, results: Result[], answer?: string }`. `S/types.ts:34-38`.
- F36. Each result: `title`, `url`, `snippet` (strings, always present, may be empty), and optional
  `content`, `score` (number), `publishedDate` (string), plus `source`, the provider that produced it.
  `S/types.ts:22-30`.
- F37. Which providers fill which optional fields:
  - `content`: Exa (only on `searchDepth: "advanced"`), Parallel (only when a result has two or more
    excerpts, the excerpts joined with a blank line). `S/providers/exa.ts:58-61`; `parallel.ts:89-92`.
    No other provider sets `content`.
  - `score`: Tavily, Exa. `S/providers/tavily.ts:50`, `exa.ts:62`.
  - `publishedDate`: Tavily, Exa, Perplexity, Serper, Parallel. `tavily.ts:51`, `exa.ts:63`,
    `perplexity.ts:60`, `serper.ts:51`, `parallel.ts:93`. Brave and Sonar set none.
  - `answer`: Tavily (always requests it), Serper (answer box, when Google shows one), Perplexity Sonar
    (the model's synthesized reply). `tavily.ts:35,54`; `serper.ts:54`; `perplexity-sonar.ts:54,65`.
- F38. Perplexity Sonar results carry only `url`: `title` and `snippet` are empty strings, and the
  results are the citations the model returned. `S/providers/perplexity-sonar.ts:57-66`.
- F39. Results are cut to `maxResults`. `S/providers/perplexity.ts:56`, `serper.ts:47`, `brave.ts:44`,
  `perplexity-sonar.ts:59`, `parallel.ts:80-82`; Exa and Tavily pass `numResults` / `maxResults` to the SDK.
- F40. The existing page's output sample comments `content` as "Full text (when searchDepth is
  advanced)". That is true for Exa only. Parallel's `content` follows excerpt count (F37). `apps/docs/docs/tools/search.md`
  output block versus `S/providers/parallel.ts:89-92`. Code wins.
- F41. On failure, `search` throws; it does not return an error-shaped result (F13, F14, F18, F19).
  How a generator reports a thrown tool error to the model is the generator's behavior, not covered here.

## Fit with its neighbours

- F42. The generator's `search` field (`search: true` or a config object) is a different system: it turns
  on the model provider's own built-in web search (Anthropic, OpenAI, Google), which runs inside the
  provider and returns source items in the stream, with no separate search API key. `apps/docs/docs/fundamentals/blocks.md:224-239`.
- F43. The two share no config. `tier` is `tools.search` only; `searchDepth` exists on both with
  different values (`"basic" | "advanced"` here, `"low" | "medium" | "high"` on the generator, mapped to
  OpenAI's `searchContextSize`). `apps/docs/docs/fundamentals/blocks.md:258-266`; `packages/tools/README.md`
  paragraph after "Configuration". Generator-native domain fields are `allowedDomains` /
  `blockedDomains`, not `includeDomains` (blocks.md:247-250).
- F44. Reach for `tools.search` for a chosen provider or portability across providers; reach for
  generator-native search for built-in grounding with minimal setup. `apps/docs/docs/tools/search.md` last section.
- F45. `fetch` reads the full content of a result's URL. `apps/docs/docs/tools/overview.md:59`
  ("search for a topic, then fetch the most relevant results"). Sibling pages: `catalog/tools/fetch`, `catalog/tools/index`.
- F46. Search is one of the tools in the catalog "tools" group alongside fetch, crawl, bash, MCP and
  workspace. `docs/contributing/docs-revamp/pages/catalog/tools/` listing; `apps/docs/docs/tools/overview.md:7`.

## Slots (sitemap: "Slots it fills: `search` in `tools`")

- F47. The block goes in a generator's `tools` array: `tools: [tools.search()]`. `apps/docs/docs/tools/search.md`
  Basic usage; `apps/kitchen-sink/flows/chat-agent/shared/capabilities/features.ts:45,68,185`
  (the kitchen-sink also pushes it into a tools list conditionally). Slot name is `tools`.
- F48. Opens no slots, fills no views, stores nothing (sitemap: Views "None"; confirmed by the stored-data section).

## For the example (pick names from the one-app layout)

- E1. A block file `src/flows/research/blocks/...` holding a generator with `tools: [tools.search()]`
  needs `generator` from `@flow-state-dev/core` and `tools` from `@flow-state-dev/tools`. Existing
  page imports both. Model string used by the existing page is `anthropic/claude-sonnet-5-5`; the house
  small-model name is `openai/gpt-6-luna`.
- E2. `generator({ name, model, prompt, tools })` is the shape the existing page uses; type-check
  against `packages/core/src/blocks/generator.ts` when writing.

## Loose ends for the caller

1. **Code contradicts README and `SearchConfig` JSDoc**: `maxResults` and `topic` on the config do
   nothing (F21). Left off the page. Candidate fix for the maintainers: remove the keys, or have
   `execute` read them.
2. The existing page opens "wraps seven providers" and "normalizes the results": true (F4, F35-F37). Its
   Provider table lists Perplexity Sonar after Brave: true to the priority order, but Sonar is never
   auto-selected when `PERPLEXITY_API_KEY` is the only key (F10).

## Revise round 1 additions

- F49. Verified: Parallel maps `balanced` and `deep` to the same `mode: advanced`, so `deep` equals
  `balanced` on Parallel (F25). The page states it in "Which provider runs".
- F50. Verified: `fast` is served by every provider including Serper and Brave, so `fast` and `balanced`
  never change auto-selection (F12). Perplexity Sonar is not reachable by auto-detection on the shared
  `PERPLEXITY_API_KEY` alone (F10); the page says to use `provider: "perplexity-sonar"` or `perplexitySonarSearch`.
- F51. Correction: `searchDepth: "advanced"` on Tavily selects Tavily's `advanced` retrieval depth, the
  same value `tier: "deep"` selects (F25, F27); it is not only a content-size setting.
  `S/providers/tavily.ts:27-30`.
- F52. `searchMode` is read by Exa, Parallel and Perplexity Sonar only; the others ignore it (F26).
  When no keyed provider serves the tier, the first keyed provider in priority order runs and ignores
  the tier (F11, F28).
- F53. Moved to Reference R-42 (`reference/tools`, linked as `../../reference/tools.md`): providers
  table with env vars and packages, tier mapping per provider, domain-filter mechanics, output field
  provider matrix, generator `searchDepth` values. The page keeps the idea and one example each.
- F54. `keys` is `Partial<Record<SearchProviderName, string>>`, an API key passed in code instead of
  read from the environment (F8). `S/types.ts:95`.

## Revise round 2 additions

- F55. Only Serper and Brave have no depth parameter; Parallel maps `fast` to `basic` and `balanced`/`deep` to `advanced` (F25). The page's tier section now says so, so "each provider maps it" became "providers with a depth setting map it". The Parallel limit moved from "Which provider runs" to the tier section.
## Revise round 3 additions

- F57. The page's domain-filters section now says `includeDomains` is an allowlist, `excludeDomains` a denylist, both config only so the model cannot set or change them (F29), and that with Perplexity or Sonar an include list drops `excludeDomains`, so an excluded subdomain of an included domain (`blog.arxiv.org`) can still appear (F31). "Which provider runs" gains a worked example: `PERPLEXITY_API_KEY` plus `BRAVE_SEARCH_API_KEY` with `tier: "deep"` runs Perplexity, which is first in order and supports deep while Brave serves only fast and balanced (F7, F11, F12).

- F56. Generator `searchDepth` is `"low" | "medium" | "high"` (`packages/core/src/types/model.ts:31`); the page names the values in its last section.
