---
title: Tools
type: reference
description: "Options, providers, output shapes and errors for the search, fetch, crawl, bash and MCP tools, the sandbox providers behind bash, and the workspace projection under it."
---

# Tools

`@flow-state-dev/tools` gives a generator reach outside the model: search the web, read a page, crawl a site, run shell commands, call an MCP server's tools. Each tool presents the model with one name, one input and one output shape. What answers behind it is a provider, picked from the API keys in your environment, so swapping Tavily for Exa or Firecrawl for the built-in reader changes no prompt and no code that reads results.

Search, fetch and crawl are handler blocks. Bash and MCP come as capabilities, bundles that add tools and a block of guidance for the model. The files bash edits move through `@flow-state-dev/workspace`, covered at the end.

This page uses one app. Its `research` flow has a `researcher` generator that searches, reads and crawls, and a bash sandbox whose files persist. How to choose among the tools is on [Tools](../catalog/tools/index.md); each tool's own page teaches it with examples.

```ts title="src/flows/research/blocks/researcher.ts"
import { generator } from "@flow-state-dev/core";
import { tools, firecrawlFetch } from "@flow-state-dev/tools";

export const researcher = generator({
  name: "researcher",
  model: "openai/gpt-6-luna",
  prompt: "Find sources, read them, and answer with links.",
  tools: [
    tools.search({ tier: "deep", includeDomains: ["docs.python.org"] }),
    firecrawlFetch({ waitForJS: true }),
    tools.crawl({ includePatterns: ["/docs/**"] }),
  ],
});
```

## The tools

| Tool | Built with | Name the model sees | With no keys |
| --- | --- | --- | --- |
| `tools.search()` | handler | `search` | Throws when it runs, not when it is built |
| `tools.fetch()` | handler | `fetch` | Works: the built-in reader |
| `tools.crawl()` | handler | `crawl` | Works: the built-in crawler |
| `createBashCapability()` | capability of three blocks | `bash`, `bash-read-file`, `bash-write-file` | Works: `just-bash`, needs its optional package |
| `createBashTool()` | AI SDK `tool()` objects | `bash`, `readFile`, `writeFile` | Same default provider |

Tool objects read the environment on every call, so a key set after construction is picked up. `search`, `fetch` and `crawl` are also exported on their own (`search`, `fetch`, `crawl`) and each has a subpath: `@flow-state-dev/tools/search`, `/fetch`, `/crawl`, `/bash`, `/mcp`.

The package needs Node 22 or later.

### API keys

`config.keys` beats the environment for every provider.

| Variable | Serves |
| --- | --- |
| `TAVILY_API_KEY` | Search: Tavily |
| `EXA_API_KEY` | Search: Exa |
| `PERPLEXITY_API_KEY` | Search: Perplexity and Perplexity Sonar (one key, two providers) |
| `SERPER_API_KEY` | Search: Serper |
| `BRAVE_SEARCH_API_KEY` | Search: Brave |
| `PARALLEL_API_KEY` | Search: Parallel |
| `FIRECRAWL_API_KEY` | Fetch and crawl: Firecrawl |
| `JINA_API_KEY` | Fetch: Jina, optional. Jina is picked automatically only when this is set; without it, Jina is used when you name it |

`keys` is `Partial<Record<SearchProviderName, string>>` for search (Sonar is `keys["perplexity-sonar"]`), `{ firecrawl?, jina? }` for fetch and `{ firecrawl? }` for crawl.

### Optional packages

Install only the packages for the providers you use.

| Package | Needed by |
| --- | --- |
| `@tavily/core` | Search: Tavily |
| `exa-js` | Search: Exa |
| `@mendable/firecrawl-js` | Fetch and crawl: Firecrawl |
| `just-bash` | Bash: the `just-bash` sandbox |
| `@ai-sdk/mcp` | MCP |

A missing package throws a plain `Error` when the tool is called, naming the package and the install command. Perplexity, Serper, Brave, Parallel, Perplexity Sonar, Jina and the built-in fetch and crawl need none. `just-bash` and `@ai-sdk/mcp` fail differently; see [Sandbox providers](#sandbox-providers) and [MCP](#mcp).

## Search

`tools.search(config)` takes `SearchConfig`. Each provider also has a constructor that fixes the provider and takes the same config without `provider`: `tavilySearch`, `exaSearch`, `perplexitySearch`, `serperSearch`, `braveSearch`, `parallelSearch`, `perplexitySonarSearch`.

### Providers

`searchProviders` lists the providers below.

| Provider | `provider` | Key variable | Package | Auto-select rank | Tiers |
| --- | --- | --- | --- | --- | --- |
| Parallel | `parallel` | `PARALLEL_API_KEY` | none | 1 | all |
| Tavily | `tavily` | `TAVILY_API_KEY` | `@tavily/core` | 2 | all |
| Exa | `exa` | `EXA_API_KEY` | `exa-js` | 3 | all |
| Perplexity | `perplexity` | `PERPLEXITY_API_KEY` | none | 4 | all |
| Serper | `serper` | `SERPER_API_KEY` | none | 5 | `fast`, `balanced` |
| Brave | `brave` | `BRAVE_SEARCH_API_KEY` | none | 6 | `fast`, `balanced` |
| Perplexity Sonar | `perplexity-sonar` | `PERPLEXITY_API_KEY` | none | 7 | all |

### Which provider runs

1. With `provider` set, that provider runs. With no key for it, the call throws `Search provider "<name>" requested but no API key found. Set <VAR> or pass it via config.keys.<name>`.
2. Otherwise the first provider in rank order that has a key and serves the requested `tier` runs. `tier: "deep"` skips Serper and Brave even when they have keys.
3. If no keyed provider serves the tier, the first keyed provider runs and ignores `tier`.
4. With no key at all, the call throws `No search provider available. Configure at least one of: ...`.

The choice is made on every call. Perplexity and Sonar share a key and Perplexity ranks first, so automatic selection never picks Sonar: name it with `provider: "perplexity-sonar"` or `perplexitySonarSearch()`.

### Options

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `provider` | one of the seven names | auto-select | Forces a provider |
| `tier` | `fast` \| `balanced` \| `deep` | `balanced` | Retrieval thoroughness. Mapping in the next table |
| `agentControlsTier` | boolean | `false` | When `true`, the tool gains a `tier` parameter the model sets, and the configured `tier` becomes its default |
| `searchDepth` | `basic` \| `advanced` | `basic` | How much content a provider returns per result. Separate from `tier` |
| `searchMode` | string | none | A provider's own mode, passed through and preferred over the `tier` mapping: Exa `type`, Parallel `mode`, Sonar model name. Other providers ignore it |
| `includeDomains` | `string[]` | none | Restrict results to these domains |
| `excludeDomains` | `string[]` | none | Drop these domains |
| `keys` | `Partial<Record<SearchProviderName, string>>` | environment | Explicit keys |

`SearchConfig` also declares `maxResults` and `topic`, but the config values have no effect. Both are call parameters the model sets.

The model supplies: `query` (required), `maxResults` (default 5), `topic` (`general` or `news`, default `general`) and, with `agentControlsTier`, `tier`. `topic: "news"` is honoured by Tavily and Serper; the others ignore it. Results are capped at `maxResults`.

### `tier` and `searchDepth` by provider

`balanced` is served by every provider, so the default never changes which provider is chosen.

| Provider | `fast` | `balanced` | `deep` |
| --- | --- | --- | --- |
| Exa | `type: "fast"` | `type: "auto"` | `type: "deep"` |
| Tavily | basic depth | basic depth | advanced depth |
| Perplexity | `search_context_size: low` | provider default | `search_context_size: high` |
| Perplexity Sonar | model `sonar` | `sonar` | `sonar-reasoning` |
| Parallel | `mode: basic` | `mode: advanced` | `mode: advanced` |
| Serper | ignored | ignored | ignored |
| Brave | ignored | ignored | ignored |

`searchDepth: "advanced"` affects Tavily, Exa and Parallel. Tavily searches at advanced depth if either `tier` is `deep` or `searchDepth` is `advanced`. Exa returns full text in `content`; at `basic` it caps text at 500 characters and leaves `content` unset. Parallel returns up to 6000 characters per result instead of 1500. Perplexity, Serper, Brave and Sonar ignore it.

### Domain filters

Every provider applies `includeDomains` and `excludeDomains`, in different ways.

| Provider | How |
| --- | --- |
| Tavily, Exa | Native include and exclude fields |
| Parallel | `source_policy` include and exclude lists |
| Perplexity, Perplexity Sonar | One `search_domain_filter`, an allowlist or a denylist. With any include domain only the includes are sent, so an excluded subdomain of an included domain can appear. With only excludes, each is sent with a `-` prefix |
| Serper, Brave | `site:` and `-site:` operators in the query. Several includes are OR-grouped, excludes are AND-chained |

### Output

`searchOutputSchema`: `{ query, results, answer? }`. Each result is `{ title, url, snippet, content?, score?, publishedDate?, source }`, where `source` is the provider's name.

| Field | Set by |
| --- | --- |
| `content` | Exa at `searchDepth: "advanced"`; Parallel when a result has more than one excerpt. No other provider |
| `score` | Exa and Tavily, when the provider returns one |
| `publishedDate` | Tavily, Exa, Perplexity, Serper, Parallel. Not Brave or Sonar |
| `answer` | Tavily, Serper (its answer box), Sonar (the model's reply) |

Sonar returns one result per citation, with an empty `title` and `snippet`.

### Errors

Search throws plain `Error`s: no `code`, no `retryable`. A non-2xx response throws `<Provider> API error: <status> <statusText>` (`Perplexity Search`, `Serper`, `Brave Search`, `Perplexity Sonar`); Parallel appends the response body. Missing keys and packages are above.

### Search on the generator

`generator({ search })` turns on the model provider's own web search, inside the provider. `tools.search` calls a third-party API. They share no configuration; the generator's options are on [Generators](./generators.md).

## Fetch

`tools.fetch(config)` returns one page as markdown. The model supplies `url`. `firecrawlFetch`, `jinaFetch` and `builtinFetch` fix the provider.

### Options

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `provider` | `firecrawl` \| `jina` \| `builtin` | auto-select | Forces a provider |
| `waitForJS` | boolean | `false` | Firecrawl only, which then waits 5000 ms for scripts. Jina and the built-in reader ignore it |
| `keys.firecrawl`, `keys.jina` | string | environment | Beat `FIRECRAWL_API_KEY` and `JINA_API_KEY` |

Timeouts, limits and request headers are not configurable.

### Providers

| Provider | Key | Package | How it reads | Reported `url` | `contentType` | `description` |
| --- | --- | --- | --- | --- | --- | --- |
| Firecrawl | `FIRECRAWL_API_KEY`, required | `@mendable/firecrawl-js` | Firecrawl's scrape, as markdown | The URL requested | The page's, else `text/html` | Yes |
| Jina Reader | `JINA_API_KEY`, optional | none | `GET https://r.jina.ai/<url>`; sends `Authorization` only with a key | The URL requested | Always `text/html` | Yes |
| Built-in | none | none | Fetches locally with `User-Agent: Mozilla/5.0 (compatible; FlowStateDev/1.0)`, extracts the article with Readability, converts it to markdown | The final URL after redirects | The response's, else `text/html` | Never |

Rendering JavaScript and getting past bot walls are what Firecrawl and Jina offer; the built-in reader reads static HTML only. The built-in reader returns the article as markdown with ATX headings and fenced code blocks, or the whole page body when it finds no article. A page with no readable content returns best-effort markdown, not an error.

### Which provider runs

`provider: "builtin"` runs the built-in reader. `provider: "firecrawl"` with no key throws `Fetch provider "firecrawl" requested but no API key found. Set FIRECRAWL_API_KEY or pass it via config.keys.firecrawl`. `provider: "jina"` works without a key. With no `provider`: Firecrawl if its key is set, else Jina if its key is set, else the built-in reader. Fetch never fails for lack of a provider. The choice is made on every call.

### Output

`fetchResultSchema`:

| Field | Type | Note |
| --- | --- | --- |
| `url` | string | See Providers |
| `title` | string | |
| `markdown` | string | |
| `metadata.statusCode` | number | |
| `metadata.contentType` | string | |
| `metadata.description` | string, optional | Firecrawl and Jina only |
| `metadata.publishedDate` | string, optional | In the schema; no bundled provider sets it |
| `metadata.wordCount` | number | Whitespace-separated tokens of the markdown |
| `source` | `firecrawl` \| `jina` \| `builtin` | The provider that produced it |

### Destinations the built-in reader refuses

The built-in reader and the built-in crawler check every URL, and every redirect hop, before connecting. They refuse:

- a URL that is not absolute `http` or `https`, or that carries credentials;
- `localhost`, `*.localhost`, and any host that resolves to a private, loopback, link-local, multicast or reserved address. One non-public address among the answers is enough to refuse.

Up to 5 redirects are followed, and each hop is checked. The sixth throws. A name that answers with a public address to the check and a private one to the connection (DNS rebinding) is not caught. Firecrawl and Jina are not checked: this package sends them the URL as given.

### Errors

Structured fetch failures are `FlowError`s; the shared shape is on [Errors](./errors.md). `details.errorType` is one of `http`, `network`, `timeout`, `abort`, `parse`, `blocked`, `unknown`. Whether a retry happens is the generator's decision, from `retryable`.

| Failure | `code` | `errorType` | `retryable` | `details` |
| --- | --- | --- | --- | --- |
| Non-2xx from Jina or the built-in reader | `fetch_http_error` | `http` | 5xx, 429, 408: yes. Other 4xx: no | `httpStatus`, `httpStatusText`, `url`, and `responseBody` when non-empty, cut at 1000 characters |
| DNS, socket or TLS failure | `fetch_transport_error` | `network`, `timeout` or `abort` | `network` and `timeout`: yes. `abort`: no | `errorType`, `url`; `cause` kept on the error |
| Destination refused | `fetch_blocked_url` | `blocked` | no | `errorType`, `url` |
| Firecrawl reports failure with no HTTP response | `fetch_provider_error` | `unknown` | no | `errorType`, `url` |
| More than 5 redirects | `fetch_transport_error` | `unknown` | no | `errorType`, `url` |

A 404 is `http` and not retryable. A 403 bot wall is `http`, not retryable, with the wall's body in `responseBody`. For the built-in reader an HTTP error reports the final URL after redirects; for Jina, the URL requested. `parse` is classified but no bundled provider produces it. A forced provider with no key, or a missing package, throws a plain `Error` with no `code`.

## Crawl

`tools.crawl(config)` follows links from a root URL and returns each page as markdown. `firecrawlCrawl` and `builtinCrawl` fix the provider.

### Options

| Option | Type | Default | Set by | Effect |
| --- | --- | --- | --- | --- |
| `provider` | `firecrawl` \| `builtin` | auto-select | config | Forces a provider |
| `maxPages` | number | 20 | the call | Page limit. The model sets it |
| `maxDepth` | number | 2 | the call | Link depth from the root; the root is 0. The model sets it |
| `includePatterns` | `string[]` | `[]` | config | Only these URL paths are crawled |
| `excludePatterns` | `string[]` | `[]` | config | Skip these. Checked first; wins over include |
| `waitForJS` | boolean | `false` | config | Firecrawl only: waits 5000 ms per page |
| `keys.firecrawl` | string | environment | config | Beats `FIRECRAWL_API_KEY` |

`CrawlConfig` declares `maxPages` and `maxDepth`, but the config values never apply: the tool's input schema supplies 20 and 2, and the model can set both. Patterns are the limits only you set.

### Providers

| | Firecrawl | Built-in |
| --- | --- | --- |
| Key and package | `FIRECRAWL_API_KEY`, `@mendable/firecrawl-js` | none |
| Page limit | Sent as `limit` | Stops at `maxPages` collected pages |
| Depth | Sent as `maxDepth` | Links are followed from pages shallower than `maxDepth` |
| Patterns | Passed unchanged as `includePaths` and `excludePaths`, in Firecrawl's own syntax | Globs on the URL path |
| JavaScript | With `waitForJS` | No |
| Page `url` | `metadata.sourceURL`, else the root URL | The queued URL, as linked |
| Page `contentType` | Always `text/html` | The response's |
| Page `description` | Yes | Never |

Provider choice: `provider: "builtin"` runs the built-in crawler; `provider: "firecrawl"` runs Firecrawl, or throws `Crawl provider "firecrawl" requested but no API key found. Set FIRECRAWL_API_KEY or pass it via config.keys.firecrawl`; with neither, Firecrawl if its key is set, else the built-in crawler. It never throws for lack of a provider.

### The built-in crawler

- Breadth-first from the root. It stops at `maxPages` or when no queued links remain.
- Same origin only: a link is followed when its origin equals the root's.
- A link's `#hash` and one trailing `/` on a non-root path are dropped before the visited check.
- It waits 1000 ms before each request after the first page is collected.
- It skips without error any request that fails, any non-2xx response and any response whose `content-type` is not HTML. That includes the root: an unreachable, refused or non-HTML root returns `pages: []` and no error.
- The destination checks above run on every queued URL.
- It does not render JavaScript, handle bot protection or authentication, or read `robots.txt`.

### Patterns

Built-in patterns match the URL's path, anchored at both ends, and a trailing `/` counts. `**` matches any characters including `/`; `*` matches within one segment; `?` matches one character that is not `/`. Other characters are not escaped, so `.` matches any character. An empty include list allows every same-origin URL; an empty exclude list excludes nothing. `/docs/**` does not match `/docs`. Patterns apply to the root's path too: a root that fails `includePatterns` returns an empty result.

### Output

`crawlResultSchema`: `{ rootUrl, pages, totalPages, crawlDepth, source }`. Each page has the fetch output shape. `totalPages` is `pages.length`. `crawlDepth` is the depth limit used, not the depth reached. `source` is `firecrawl` or `builtin`.

### Errors

The built-in crawler throws only for a root that is not a URL (`TypeError: Invalid URL`). Under Firecrawl, a forced provider with no key or a missing package throws, and so does any error the Firecrawl SDK raises. A Firecrawl result with no data comes back as `pages: []`, not an error.

## Bash

Bash runs shell commands in a sandbox whose files sync with the flow's resource collections.

### Entry points

| Entry | Returns | Default provider | Mounts |
| --- | --- | --- | --- |
| `createBashCapability(options)` | A capability with presets `tools` and `guidance` (both on) and a `cleanupBlock` | `just-bash` | Discovered from `ctx.resources`, narrowed by `collections` or `exclude` |
| `createBashBlocks(options)` | `{ bashCommand, bashReadFile, bashWriteFile }`: handler blocks, or sequencers around a handler when the provider needs setup: all three for `vercel` and `upstash`, and `bashCommand` and `bashReadFile` for `moat` (its `bashWriteFile` is a plain handler) | `local` | Same |
| `createBashTool(options)` | `Promise<{ tools: { bash, readFile, writeFile }, sandbox }>`, for `providerTools` | `just-bash` | Only the `collections` you pass; all writable |

The destination is `/workspace` (`/vercel/sandbox/workspace` for Vercel, except under `createBashTool`, which always uses `/workspace`). A capability and blocks read `ctx.resources` at the first command of a sandbox and fix the mounts then.

```ts title="src/flows/research/blocks/bash-cap.ts"
import { createBashCapability } from "@flow-state-dev/tools/bash";

export const bashCap = createBashCapability({ collections: ["artifacts"], provider: { type: "local", scope: "run" } });
```

`uses: [bashCap]` on the generator gives it the tools. `request: { onFinished: bashCap.cleanupBlock }` on the flow releases the sandbox when the request ends.

`createBashCapability` and `createBashBlocks` options:

| Option | Type | Effect |
| --- | --- | --- |
| `collections` | `string \| { key, writable? }[]` | Mount only these. Strings are writable. When set, `exclude` is ignored |
| `exclude` | `string[]` | Mount everything except these |
| `provider` | `SandboxProvider` | See [Sandbox providers](#sandbox-providers) |
| `destination` | string | Where the mounts appear in the sandbox |
| `createState` | `(relativePath) => ProjectedEntryExtra` | Extra state stamped on each entry written. Capability default: `{ title: <file name> }`; blocks default: `{}`. Cannot set `path`, `hash` or `updatedAt` |

A collection with no pattern prefix, or whose prefix is `tmp`, is not mounted. A requested key that is not on `ctx.resources` logs `[bash] collection "<key>" was requested but not found on ctx.resources — skipped`.

`createBashTool` options: `collections` (a record of name to collection ref), `bashSession` (a resource ref for `BashSessionState`), `provider`, `destination`, `persist` (default `false`), `onBeforeCommand(cmd)` (a returned string replaces the command) and `onAfterCommand(cmd, result)` (a returned `CommandResult` replaces the result). It has no auto-discovery, no guidance text, no `exclude`, no read-only mounts, no idle release and no cleanup block: call `sandbox.stop()` yourself. A local provider with a `scope` throws at call time. Its `bash` tool does not prefix `cd`; the capability's does.

### The tools the model sees

| Tool | Input | Output | Behaviour |
| --- | --- | --- | --- |
| `bash` | `{ command }` | `{ stdout, stderr, exitCode }` | Runs `cd <destination> && <command>`, then flushes the workspace to the collections. A non-zero exit does not throw |
| `bash-read-file` | `{ path }` | `{ content }` | Reads from the sandbox. No flush. The path is workspace-relative |
| `bash-write-file` | `{ path, content }` | `{ success, refused }` | Writes to the sandbox, then saves only that path to its collection |

With `createBashTool` the file tools are `readFile` and `writeFile`.

`success: true` means the file reached its collection or `./tmp/`. Otherwise `success` is `false` and `refused` says why. The file is written in the workspace in every case, and only saving it is refused.

| Cause | `refused` |
| --- | --- |
| Path under no mounted collection | `"<path>" is not under any mounted collection or ./tmp/, so it was not saved.` |
| The collection's entry changed since the run last saw it | `"<path>" changed in its collection while this run held it — the write was NOT applied.` |
| Another run is writing that entry | `"<path>" is being written by another run — the write was NOT applied.` |
| Read-only mount | `"<path>" is under "<prefix>/", which is read-only — the write was NOT saved, and retrying will not save it.` |

`createBashTool`'s `writeFile` does not treat `tmp/` specially: `tmp/x.txt` is refused as under no mounted collection.

### Mounts, hydrate and flush

- A collection ref on `ctx.resources` mounts at its pattern's directory (`artifacts/**` mounts at `<destination>/artifacts/`). The longest matching prefix owns a path.
- Hydrate: before the first command, the sandbox gets an empty `.fsdev-keep` marker under `tmp/` and under each mount, and every entry of every mount. The marker is never listed or saved.
- Flush, after `bash` only: the mount directories and the files directly in the workspace root are listed. A file under a writable mount is saved to its collection with the prefix stripped. A file under a read-only mount is skipped. A file under `tmp/` is skipped and never persisted. A root-level file under no mount is dropped with a console warning. A file in an unmounted subdirectory is dropped without one. `node_modules` and `.git` trees under a mount are never listed or saved.
- A file the run deleted is deleted from its collection only if this run laid it down or saved it earlier and nobody else changed it. A file another run added is never deleted by this one.
- Only files whose SHA-256 differs from what was laid down are written.
- Each saved entry's state holds `path`, `hash` and `updatedAt` plus any `createState` fields, so the collection's state schema must accept those three. The content is the entry's content.
- If listing the workspace fails, the flush is skipped and logged, and the command's result is returned. A failed collection read or write propagates.

Conflicts, refusals between concurrent runs and read-only behaviour are the projection's; see [Workspace](#workspace).

### Sandbox providers

`provider` takes one of:

| `type` | Config | Notes | Real filesystem |
| --- | --- | --- | --- |
| `local` | `cwd?`, `scope?`, `strictPaths?`, `env?`, `execTimeoutMs?` | `execTimeoutMs` defaults to 60 000. `cwd` together with `scope` throws at construction | The host's |
| `just-bash` | `env?`, `network?`, `python?`, `javascript?`, `executionLimits?` | In-memory bash emulation with 60+ built-in commands. No real processes; cannot install packages. Network, Python and JavaScript are off by default | No |
| `vercel` | `Sandbox` (the `@vercel/sandbox` class), `sandboxId?`, `createOptions?` | You pass the class in; there is no peer dependency. `sandboxId` reconnects, absent creates | Remote |
| `moat` | See [MOAT](#moat) | A local container run by the `moat` CLI | The host directory, bind-mounted |
| `custom` | `sandbox: Sandbox` | Your own implementation | Yours |
| `upstash` | `client`, `boxId?` | Not implemented. Resolving it throws `Upstash Box adapter is not yet implemented.` | n/a |

If `just-bash` cannot be imported or constructed, the sandbox falls back to an in-memory file map that runs no commands: every command except `find ...` returns exit code 1 with `In-memory sandbox: install just-bash for full bash support`.

`just-bash` options: `network` is `{ dangerouslyAllowFullInternetAccess?, allowedUrls?: { url, methods?, headers? }[] }`. `executionLimits` takes `maxCallDepth`, `maxCommandCount`, `maxLoopIterations`, `maxAwkIterations`, `maxSedIterations`. `javascript` is `boolean | { bootstrap? }`, run as `js-exec`.

A `custom` sandbox implements `executeCommand(command)`, `readFile(path)`, `writeFile(path, content)`, and optionally `stop()` and `hostMountSource`. `CommandResult` is `{ stdout, stderr, exitCode }`.

#### The local provider

- **Environment.** A command sees `PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR` and `TZ` copied from the server when set, plus `env`. `env` wins over those, `PATH` included. Pass API tokens, proxy settings such as `HTTPS_PROXY`, CA bundle paths and `SSH_AUTH_SOCK` there; nothing else carries over.
- **Isolation.** Commands run as the server's OS user and can read the server's environment, for example through `/proc/$PPID/environ`. A process that leaves its process group (`setsid`, a daemon) survives a timeout and `stop()`. Use `moat` or a container for untrusted commands.
- **Exit codes.** The shell's own; `124` on timeout, with `exec timed out after <n>ms` appended to `stderr`; `128 + n` when killed by signal `n`; `1` for more than 10 MiB on one stream (the command is killed) or a failure to start.
- **Background jobs.** A job started with `&` outlives its command. `stop()` ends every process group the sandbox started: SIGTERM, then SIGKILL after 2 seconds.
- **`strictPaths`** (default `true`). Before each command the string is screened for `~/`, `$HOME`, `$(...)`, backticks, `<(...)`, `>(...)` and `../`, and each unquoted absolute path must resolve inside the workspace (`/dev/null`, `/dev/stdin`, `/dev/stdout`, `/dev/stderr`, `/dev/zero`, `/dev/urandom`, `/dev/random` and `/dev/fd` are allowed). A violation throws `Command rejected: token "<token>" resolves to a path outside the workspace root`. Quoted strings and heredoc bodies are not checked, so `cat "/etc/passwd"` passes. File reads and writes that escape the workspace throw. `strictPaths` guards against a cooperative agent's mistakes. It is not a security boundary. `strictPaths: false` logs a warning and turns every guard off.

### Workspace scope

The `local` provider takes a `scope`. The directory is `<process.cwd()>/.fsdev/workspaces/<scope>/<components>`, each component encoded as `enc-<id, unsafe characters replaced with "-", first 40 characters>-<12 hex of the id's SHA-256>`; an absent component is `enc-none`. With `cwd` set, that directory is used and shared by all.

| `scope` | One workspace per | Carries the tenant |
| --- | --- | --- |
| `run` | request | Yes |
| `session` (default) | session | Yes |
| `user` | user id | No |
| `org` | org id | No |

- `user` and `org` are keyed on a verified identity and are shared across tenants. `user` with no `userId` in the context uses the session workspace, tenant included; `org` with no `orgId` does the same. The caller gets a narrower workspace than the scope named, never a shared one.
- A `run` directory is keyed on the request and its incarnation. A retry or resume of the same request reuses it. A new request that reuses a deleted request's id gets an empty one.
- `session`, `user` and `org` workspaces can hold two runs at once. Only `run` gives one request a workspace nothing else shares.
- Finished directories are never removed.
- Only `local` takes a scope. Every other provider has one sandbox per session.

### Sandbox lifetime and cleanup

One sandbox exists per scope instance, held in the server process. It is created at the first command, is not persisted and is lost when the server restarts. A sandbox no command has used for 30 minutes is released. A command in flight is never released, and the clock restarts when it finishes.

`bashCap.cleanupBlock` is a handler named `bash-cleanup`, returned for every provider. Wire it with `request: { onFinished: bashCap.cleanupBlock }` to release the sandbox when the request ends. It is optional everywhere, because idle release happens anyway. Releasing stops a local sandbox's background jobs and a Vercel sandbox, stops a MOAT container only when `persist` is `false`, calls the optional `stop()` of a `custom` sandbox if it defines one, and does nothing for `just-bash`, which has none. Errors on release are logged, never thrown.

### MOAT

`provider: { type: "moat", ... }` runs commands in a container with `moat exec <run> -- sh -c ...`. The container starts with a clean environment, and outbound requests go through a proxy that injects credentials, so credentials held by MOAT never appear in the agent's environment.

**Requirements.** The `moat` CLI, version 0.4.0 or later, installed by the host operator; macOS with the Apple container runtime, or a Linux host with Docker. On first use the adapter runs `moat version --json`, then `moat grant list --json` if `grants` is set. The container is the boundary: the adapter does not check path containment on commands.

**Cost.** Commands run on the local host, with no call to a remote sandbox service. The first command pays a cold start of roughly 10 to 30 seconds, and a first run that builds the image 30 to 60 seconds or more. Readiness gives up after 60 seconds with `MoatRunTimeoutError`.

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `workspace` | string | The resolved workspace directory | Host directory bind-mounted into the container |
| `mountTarget` | string | `destination` | Mount point inside the container |
| `runName` | string | Under `createBashCapability` and `createBashBlocks`, per session: `fsdev-<session id, 20 characters>-<12 hex>`. Under `createBashTool`, the persisted `bashSession.sandboxId` if there is one, otherwise `fsdev-<random UUID>` | The container's name. An explicit name is shared by every session using the provider |
| `grants` | `string[]` | none | Grant names that must already exist (`moat grant <name>`). A missing one throws `MoatGrantsError` before the run starts |
| `allowHosts` | `string[]` | `[]` | Outbound host allowlist. Default-deny |
| `runtime` | `auto` \| `docker` \| `apple` | `auto` | Container runtime |
| `noSandbox` | boolean | `false` | Passes `--no-sandbox`, turning off gVisor under Docker |
| `configPath` | string | none | A hand-written `moat.yaml`. Used in place when inside the workspace; otherwise copied there marked `# fsdev-managed` and removed at teardown |
| `execTimeoutMs` | number | 60 000 | Per-command timeout |
| `bin` | string | `moat` | The binary name or path |
| `persist` | boolean | `true` under the capability and blocks, `false` under `createBashTool` | See below |

Without `configPath`, the adapter writes a `moat.yaml` marked `# fsdev-managed: do not edit` (`name`, `grants`, a strict network policy and `network.allow`). It refuses to overwrite a `moat.yaml` that has no marker; pass it as `configPath` or remove it.

**Persistence.** With `persist` on, `stop()` leaves the container and its `moat.yaml`, and the next request finds the container by run name through `moat list --json`. The container outlives the framework process; reclaim it with `moat stop <runName>` or `moat clean`. Changing `grants` or `allowHosts` does not apply to a live container: stop it first. Under the capability or blocks, a container with a per-session run name that no command has used for 30 minutes is stopped and destroyed by the server. A container under an explicit `runName` is left to you. With `persist: false`, release runs `moat stop`, then `moat destroy`, and removes the generated config.

**Pool bound.** On a cold start, of the runs named `fsdev-*`, all but the 50 most recently started are stopped and destroyed, oldest first, excluding the current one. It is best effort and failures are logged.

| Limit | Behaviour |
| --- | --- |
| Command timeout | Default 60 s. The command is stopped in the container; `exitCode` is `124` and `stderr` ends `exec timed out after <n>ms` |
| Output | Buffered, not streamed. More than 10 MiB on one stream kills the command with `exitCode: 1` |
| `readFile` | UTF-8 text only. Undecodable bytes throw `MoatBinaryReadError`; a missing file throws `FileNotFoundError`; a path that climbs out of the mount throws `MoatPathEscapeError` |
| After `stop()` | Any command throws `MoatRunStoppedError` |
| A crashed container | Not restarted. The next command reports the failure |
| SIGTERM or a host crash | The container keeps running |
| CLI missing, too old, grant missing | `MoatNotInstalledError`, `MoatVersionError`, `MoatGrantsError` |

`bash-write-file` for MOAT writes to the host directory without starting the container, and refuses a `..` path or a symlink that escapes the mount. The MOAT error classes carry their name in `error.name` and are not exported.

## MCP

`@flow-state-dev/tools/mcp` connects MCP servers and gives their tools to a generator. It needs the optional `@ai-sdk/mcp` package. Connection is lazy: nothing connects until the first `getTools()` or `callTool()`. A server that fails to connect, a missing package included, is marked `errored` in the catalog with its header values removed from the message and logged as `[mcp] Failed to connect to "<name>": ...`. Other servers load.

```ts title="src/flows/research/blocks/docs-mcp.ts"
import { createMcpCapability } from "@flow-state-dev/tools/mcp";

export const docsMcp = createMcpCapability({
  servers: [
    {
      name: "docs",
      transport: { type: "http", url: "https://mcp.example.com/mcp" },
      whenToUse: "Questions about the product's own documentation",
    },
  ],
});
```

### Server config

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Namespaces tools as `mcp__<name>__<tool>` |
| `transport.type` | `"http"` \| `"sse"` | yes | `http` is Streamable HTTP |
| `transport.url` | string | yes | |
| `transport.headers` | `Record<string, string>` | no | May carry credentials. `getServerConfigs()` returns them, so never log that result |
| `description` | string | no | Appears only in the guidance block |
| `whenToUse` | string | no | A `Use when: ...` line in the guidance block |
| `examples` | `string[]` | no | An `Examples:` list under the server's section |
| `category` | string | no | Groups servers under a heading in the guidance block; servers with none go last under `Other`. With `enrichDescriptions: "category"` it also prefixes tool descriptions |

### Capability options

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `servers` | `MCPServerConfig[]` | none | Builds a manager. Give exactly one of `servers` or `manager` |
| `manager` | `MCPManager` | none | Use a manager you built with `createMcpManager` |
| `filterTools` | `(ctx, tools) => tools` | `defaultMcpFilterTools` | Replaces the default unless you call it inside yours |
| `enrichDescriptions` | `"prefix"` \| `"category"` \| `false` | `"prefix"` | `[<server>] <description>`; `[<server> · <category>] <description>`, falling back to the prefix form for a server with no category; or unchanged |
| `formatGuidance` | `(catalog) => string` | `defaultMcpGuidanceFormatter` | Builds the guidance block |

Presets are `tools` (the filtered, enriched tool list) and `guidance` (a context string under the key `mcp`), both on. `docsMcp.with({ guidance: false })` turns one off.

### Guidance block

Only connected servers appear. With none connected the block is empty. If no connected server sets `description`, `whenToUse` or `examples` (`category` alone does not count), the block is short: a heading, the server names and the `mcp__<server>__tool_name` prefix. Otherwise the block is grouped by category, and a server with none of the three gets one line giving its `mcp__<name>__` prefix.

### Turning tools off for a request

The capability adds request state `mcp.disabledServers: string[]` and `mcp.disabledTools: string[]` (namespaced tool names). `defaultMcpFilterTools` removes the matching tools for that request and leaves connections open. A tool in `disabledTools` is removed whether or not it came from an MCP server; `disabledServers` leaves tools that carry no MCP marker alone. For session-wide disabling, write a `filterTools` that calls `defaultMcpFilterTools` and then removes more.

### Manager

`createMcpManager({ servers })` returns:

| Method | Returns |
| --- | --- |
| `getTools()` | Every server's tools as handler blocks named `mcp__<server>__<tool>`, with the server's own JSON Schema as input. The server validates arguments |
| `getCatalog()` | `{ servers: [{ name, metadata, status, error?, tools }] }`, where `status` is `pending`, `connected` or `errored` and each tool has `name`, `originalName`, `description`, `inputSchema`, `jsonSchema`. Callable before connection; every server is then `pending` |
| `getConnectedServerNames()` | Names of connected servers |
| `getServerConfigs()` | The configs, headers included |
| `callTool(name, args, { signal? })` | What the server's client returned. Connects first. Throws `No connected MCP server has a tool named <name>.` for an unknown name or a server that failed to connect, and throws before calling if the signal is aborted |
| `close()` | Closes connections and resets to `pending`. Safe to call twice |

A tool the server marks as not executable returns `{ error: "Tool <t> on server <s> does not support execution." }`.

## Workspace

`@flow-state-dev/workspace` moves files between resource collections and a place an agent works, and reports what happened to each path. Bash uses it; you can call it directly. `createProjection` builds a projection from mounts and a place. Its `hydrate()` lays collection entries into the place, `flush()` reads the place back, and `put(path, content)` decides one path.

### Mount

| Field | Type | Effect |
| --- | --- | --- |
| `prefix` | string | Where the collection's entries appear in the place (`artifacts` gives `artifacts/notes.md`) |
| `collection` | collection ref | The stored side |
| `collectionId` | string | Required. What the collection is: the same string for two runs addressing the same rows. Build it with `collectionIdFor(collection, principalFromContext(ctx))` |
| `scope` | string | Optional key prefix inside the collection (`"a"` addresses `a/...`), not visible in the place. No leading, trailing or repeated `/`, no `.` or `..` segment |
| `writable` | boolean | `false`: hydrated, then never written back |
| `entryState` | `(key) => ProjectedEntryExtra` | Extra state stamped on each entry written, such as a title. The projection's own `path`, `hash` and `updatedAt` win over anything it returns |

`createProjection` throws when two mounts share one `collectionId`. Two different collections at nested prefixes are allowed.

### Routing

The mount owning a path is the one with the longest matching prefix. The boundary must be a `/`: `artifacts-old/x` belongs to neither `artifacts` nor its collection. A path equal to a prefix routes to nothing. A path under no mount is an orphan and is never filed into a default collection. Paths are normalised: backslashes become `/` and a leading `./` or `/` is removed. A collection's own bookkeeping keys (a bare key starting with `_`) are never hydrated, flushed or put.

### Outcomes

`flush()` resolves with a `FlushReport`, `{ outcomes, conflicts, contested }`, holding an outcome for every path it reached. It throws `PlaceUnreadableError` when the place cannot be listed, and rejects with the underlying error when a collection read, write or delete fails.

| `kind` | When |
| --- | --- |
| `unchanged` | The place's content hashes to what the projection last laid down |
| `created` | The projection had no record of the path and the collection held nothing: written |
| `written` | The collection holds what the projection last committed: written |
| `converged` | The collection already holds exactly this content: nothing written |
| `deleted` | The run removed a file the projection owned, and the collection held what the projection committed or the entry was already gone |
| `orphan` | A path no mount owns. From `put`, any path under no mount. A flush reports it only for a path inside a mount prefix that nothing owns, because it lists the place by mount prefix |
| `readonly` | `put` only: the path is under a read-only mount, with its `prefix`. Retrying never clears it. A flush skips read-only paths |
| `contested` | Another operation is writing this entry. See below |
| `conflict` | Two writers changed the entry. Carries `path`, `base`, `theirs`, `ours` |

**Conflict.** A flush with a conflict is a successful flush: every uncontested path landed, and the contested path is untouched, nothing written and nothing deleted. `report.conflicts` lists, per entry, `path`; `base`, the hash the projection last committed or `null`; `theirs`, the hash the collection holds at flush or `null`; and `ours`, the hash the place holds at flush, or `null` when the run deleted it. A delete where the collection changed underneath is a conflict with `ours: null`.

**Ownership.** The projection owns the paths it laid down and the paths it committed since. A path it never laid down is created if the collection is empty there, `converged` if it holds the same content, and otherwise a conflict. It is never deleted or overwritten. Read-only paths are never owned. Ownership lasts as long as the projection object and is not persisted, so a resumed session with no record owns nothing. `ownedPaths()` lists it.

**`put(path, content)`** decides one path by the same three-way check as a flush. It resolves a `FlushOutcome`, or `undefined` for a collection's own metadata key. `created`, `written` and `converged` make the path owned, so a later flush can delete it. `conflict`, `contested`, `readonly` and `orphan` leave it unowned.

### Concurrent writers

The second run to write an entry another operation holds gets `contested`: nothing is written, its file stays in the place for a retry, and it appears in `report.contested`. A delete counts as a write. A path that was only read, unchanged, is never held. `contested` means another operation is writing at that moment, with nothing to compare; `conflict` means an earlier write, with three hashes to compare.

- **The unit is the stored entry** (collection plus key), not a path. Two sessions each writing `artifacts/report.md` are writing different entries and do not refuse each other.
- **`principalFromContext(ctx)`** reads `{ sessionId, requestId, requestIncarnation, userId, orgId, tenantId }` from an execution context. `collectionIdFor(collection, principal)` joins the collection's scope, that scope's instance and its pattern. Two different flows whose collections have the same scope, scope instance and pattern get the same id, so either can be told `contested` over a row the other holds.
- **`unscopedCollectionId(collection)`** is for code with no execution context, such as `createBashTool`. It uses scope and pattern only, so it can report `contested` where a context-aware id would not. A `contested` result is retryable.
- **A claim lasts one operation**, one `flush` or one `put`, not the projection. A session's workspace is one projection serving every request in the session.
- **Arbitration is in-process.** Two servers writing one collection are not arbitrated.
- **The `claims` option** takes a `ClaimRegistry` from `createClaimRegistry()` to limit arbitration to a set of projections. Omitted, projections share `sharedClaimRegistry` across the process.

### Places

A `Place` has `read(path): Promise<string | null>`, `write(path, content): Promise<void>` and `list(prefixes): Promise<readonly string[]>`. It runs no commands. `list` must throw when the place cannot be read: an empty array says "readable and empty", and a flush acts on that by deleting what it owns. The projection wraps a failing `list` in `PlaceUnreadableError`, thrown by `flush` only. Nothing was read or written, so you may swallow it. Any other flush rejection means work did not reach the store.

| Place | Behaviour |
| --- | --- |
| `createHostPlace(root)` | A real directory. Creates `root` if missing. Refuses a path that resolves outside it (`path escapes the workspace root`), a symlink at the leaf on read and write, and a symlink in the parent chain that leads outside. `list` does not list or follow symlinks, lists a nested-prefix file once, treats a prefix with no directory as empty, and throws if the root is gone |
| `createMemoryPlace(initial?)` | Files in a map. Adds `snapshot()`, `remove(path)` and `breakListing(reason?)`, which makes every later `list` throw |

### Pull requests on a branch

`recordBranchPullRequests(ctx, options)` records the pull requests a checkout's branch has. Its options and results are on [Harness runs](./harness-runs.md).

## What is stored

Search, fetch and crawl store nothing; results are returned to the generator.

| Part | Owner | Visible to | Stored in | How many |
| --- | --- | --- | --- | --- |
| File entries synced from a mount | The collection's own scope; bash is a view | Whoever can read the collection, and the model through the tools | The collection's store | One per file key per collection |
| Local workspace directory | The scope instance (`run`, `session`, `user` or `org`) | Any run in that scope, and the server's OS user | `<process.cwd()>/.fsdev/workspaces/<scope>/<...>/`, or `cwd`. Never removed | One per scope instance |
| Live sandbox | The server process | In-process | A process-wide map. Lost on restart; released after 30 idle minutes | One per scope instance, per session for every provider but `local` |
| `bashSession` singleton (`sandboxId`, `provider`, `lastSyncedAt`, `workingDirectory`) | The resource you pass to `createBashTool` | Whoever can read that resource | That resource's store, written only with `persist: true` and a provider that returns an id (Vercel: the sandbox id; MOAT: the run name) | One |
| Projection ownership and claims | The projection and the operation | In-process | Memory. Claims are released at the end of each flush or put | One ownership record per projection |
| MOAT container and `moat.yaml` | The host operator's machine | The operator (`moat list`) and the framework process | The container runtime; `moat.yaml` in the workspace and under `<os tmpdir>/fsdev-moat/<runName>` | One per session by default; 50 `fsdev-*` runs kept |
| MCP connections and catalog | The manager | In-process | Memory. `close()` clears it | One connection per server |
