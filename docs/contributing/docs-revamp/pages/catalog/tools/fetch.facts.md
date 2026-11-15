# Fact sheet: Fetch (K-31, `catalog/tools/fetch`)

Sources cited: the exported surface and doc comments in `packages/tools/src/fetch/`, its tests under
`packages/tools/test/fetch/` and `packages/tools/test/_internal/`, the existing user docs
(`apps/docs/docs/tools/fetch.md`, `apps/docs/docs/tools/search.md`, `packages/tools/README.md`,
`apps/docs/docs/advanced/error-handling.md`), and one example
(`apps/kitchen-sink/workforce/teams/support/workers/fsd/blocks/fetch.ts`). No spec is cited.
Paths are relative to the repo root. `F/` is `packages/tools/src/fetch/`, `T/` is
`packages/tools/test/fetch/`, `I/` is `packages/tools/src/_internal/`.

## Stored data: the four questions

The tool stores nothing. It holds no resource, collection, state or session data; each call is one
HTTP request (or one Firecrawl SDK call) and returns the result. Owner, visibility, location and
count do not apply. API keys live in the host's environment variables or the config object you pass.
Evidence: `F/index.ts:26-32` (the whole `execute`), `F/resolver.ts:342-353` (keys read from config or
`process.env`). Block calls are recorded by the framework for every block; that is not Fetch's to document.

## What it is

- F1. `fetch` is a handler block named `fetch`, built for a generator's `tools` list. `F/index.ts:19-20`;
  `T/fetch.test.ts:73` ("returns a block definition with correct metadata").
- F2. Model-facing description: "Fetch a web page and return its content as markdown. Use this to read
  the full content of a URL found via search or provided by the user." `F/index.ts:21-23`.
- F3. Input is one field, `url` (string, described "The URL of the web page to fetch"). `F/types.ts:85-87`.
  There are no other model-supplied parameters.
- F4. Reachable as `tools.fetch(...)` and `fetch(...)` from `@flow-state-dev/tools`, and as `fetch` from
  the subpath `@flow-state-dev/tools/fetch`. `packages/tools/src/index.ts:6,19`; `packages/tools/package.json:38-40`;
  example import `apps/kitchen-sink/workforce/teams/support/workers/fsd/blocks/fetch.ts:13`.
  `tools.fetch()` and `fetch()` return the same block definition. `T/fetch.test.ts:81`.
- F5. Config is taken at build time and is optional: `fetch(config: FetchConfig = {})`. `F/index.ts:18`.
  `FetchConfig` has `provider` (`"firecrawl" | "jina" | "builtin"`), `waitForJS` (default `false`) and
  `keys` (`{ firecrawl?, jina? }`). `F/types.ts:62,93-103`; default at `F/index.ts:29`.
- F6. Three providers: Firecrawl, Jina Reader, built-in. `F/types.ts:62`.
- F7. Direct constructors `firecrawlFetch`, `jinaFetch`, `builtinFetch` lock the provider; each takes the
  config minus `provider`. `F/index.ts:37-47`; `T/fetch.test.ts:125-141`.
- F8. Block can be renamed with `.as({ name })`; the example builds `fetch().as({ name: "fetch-docs-page" })`.
  `apps/kitchen-sink/workforce/teams/support/workers/fsd/blocks/fetch.ts:38`.
- F9. Exports for composing your own wrapper: `fetchInputSchema`, `fetchResultSchema`, `fetchProviders`,
  and types `FetchConfig`, `FetchResult`, `FetchProviderName`, `FetchInput`. `F/index.ts:49-57`.

## What happens with no provider key (sitemap question 1)

- F10. It still works. With no `provider` and no key, the built-in provider is used; fetch never throws a
  "no provider available" error. `F/resolver.ts:338-339`; `T/resolver.test.ts:87-96` ("falls back to
  builtin when no keys available", "never throws").
- F11. Auto-selection order: Firecrawl if its key is present, else Jina if its key is present, else
  built-in. `F/resolver.ts:327-339`; `T/resolver.test.ts:68-86`.
- F12. Keys: `config.keys.<provider>` first, then env var. Firecrawl `FIRECRAWL_API_KEY`, Jina
  `JINA_API_KEY`. `F/resolver.ts:304-307,342-353`; `T/resolver.test.ts:98-107` ("prefers config key
  over env var").
- F13. Jina is auto-selected only when a key exists. Named explicitly (`provider: "jina"` or `jinaFetch()`),
  it runs with no key and sends no `Authorization` header. `F/resolver.ts:318,333-336`;
  `F/providers/jina.ts:10-12`; `T/resolver.test.ts:42` and `T/providers/jina.test.ts:48` ("works without API key").
  The existing page says "20 RPM" without a key; no code or test states that number. Leave it out.
- F14. Naming `provider: "firecrawl"` with no key throws a plain `Error` at call time: `Fetch provider
  "firecrawl" requested but no API key found. Set FIRECRAWL_API_KEY or pass it via config.keys.firecrawl`.
  `F/resolver.ts:317-322`; `T/fetch.test.ts:143-148`. It is not a `FlowError` and carries no `details`.
- F15. `provider: "builtin"` never reads a key and never calls an outside service for the page's
  content. `F/resolver.ts:314-316`.
- F16. Firecrawl needs the optional peer package `@mendable/firecrawl-js`. If it is not installed the call
  throws `Install @mendable/firecrawl-js to use the Firecrawl fetch provider: npm install @mendable/firecrawl-js`.
  `F/providers/firecrawl.ts:7-15`; `packages/tools/package.json:107,122-124` (peer, optional).
- F17. The other providers need no extra install: built-in uses bundled `turndown`, `linkedom`
  (and Readability); Jina is a plain HTTP call to `https://r.jina.ai/<url>`.
  `packages/tools/package.json:98-102` (`@mozilla/readability`, `linkedom`, `turndown` are dependencies); `F/providers/jina.ts:16`; `I/html-to-markdown.ts:1-3`.

## What comes back on success

- F18. Every provider returns the same shape (`FetchResult`): `url`, `title`, `markdown`,
  `metadata { statusCode, contentType, description?, publishedDate?, wordCount }`, and `source`
  (`"firecrawl" | "jina" | "builtin"`, the provider that served it). `F/types.ts:67-81`.
- F19. `source` names the provider used, which is how a caller sees which one the auto-selection chose.
  `F/providers/builtin.ts:52`, `firecrawl.ts:37`, `jina.ts:47`; `T/fetch.test.ts:88-110`.
- F20. Which fields each provider actually fills:
  - built-in: `url` is the final URL after redirects; `contentType` from the response header (default
    `text/html`); no `description`, no `publishedDate`. `F/providers/builtin.ts:40-52`.
  - Firecrawl: `url` is the URL you passed; `description` from page metadata; no `publishedDate`;
    `statusCode` defaults to 200 when Firecrawl gives none. `F/providers/firecrawl.ts:27-38`.
  - Jina: `url` is the URL you passed; `description` from Jina; `contentType` is always `text/html`;
    no `publishedDate`. `F/providers/jina.ts:37-48`.
  So `publishedDate` is in the schema but no bundled provider sets it. The existing page's sample
  output shows `publishedDate: "2026-01-15"`; do not copy that.
- F21. `wordCount` is the count of whitespace-separated words in the returned Markdown, not in the
  source page. `F/providers/builtin.ts:50`, `firecrawl.ts:35`, `jina.ts:45`; `I/html-to-markdown.ts:29,37`.
- F22. A page with no readable content is not an error. Built-in falls back to converting the whole
  `<body>`, or returns an empty `markdown` string if there is no body. `I/html-to-markdown.ts:23-31`.
  A 200 response is returned as-is whatever its content type; the built-in provider asks for
  `text/html,application/xhtml+xml` and converts the body as HTML. `I/fetch-validated.ts:47-52`;
  `F/providers/builtin.ts:39-41`.

## How the built-in provider gets the page

- F23. Steps: fetch with User-Agent `Mozilla/5.0 (compatible; FlowStateDev/1.0)`, extract the article
  with Readability, convert to Markdown with Turndown (ATX headings, fenced code blocks, `-` bullets).
  `I/fetch-validated.ts:47-53`; `I/html-to-markdown.ts:5-9,20,33`; `T/providers/builtin.test.ts:49-69`.
  If Readability finds no article, the whole body is converted instead. `I/html-to-markdown.ts:23-27`.
- F24. No JavaScript is run. The built-in provider ignores `waitForJS` (the option is accepted and
  unused). `F/providers/builtin.ts:14` (`_options`).
- F25. `waitForJS: true` is used by Firecrawl (waits 5000 ms before scraping). Jina's adapter does not
  read `waitForJS`; the option is documented in the type as "Firecrawl, Jina" but only Firecrawl acts on
  it. `F/providers/firecrawl.ts:20`; `F/providers/jina.ts` (no reference); `F/types.ts:96`.
  The existing page says Jina does JS rendering and that `waitForJS` applies to it; the code does not
  show that. Say only that Firecrawl honours `waitForJS`.
- F26. Redirects: the built-in provider follows up to 5 redirects (301, 302, 303, 307, 308) by hand,
  checking each target, and reports the final URL in `url`. More than 5 throws a transport error
  (`fetch_transport_error`). `I/fetch-validated.ts:16-17,41-68`; `T/providers/builtin.test.ts:108-149`.

## What it will not fetch (built-in only)

- F27. The built-in provider reaches publicly routable addresses only. Refused before any request is
  made: loopback, link-local (including cloud metadata such as `169.254.169.254`), private (RFC1918),
  and reserved ranges; the literal host `localhost` and `*.localhost`. `I/public-url.ts:42-99,101-119`;
  `T/providers/builtin.test.ts:79-89`.
- F28. A URL is also refused when it is not absolute, is not http or https, or carries a username or
  password. `I/public-url.ts:52-64`.
- F29. If a hostname resolves to several addresses and any one is non-public, it is refused.
  `I/public-url.ts:81-88`.
- F30. Every redirect hop gets the same check. A public page that redirects to `127.0.0.1` is refused
  and no request goes to the second address. `I/fetch-validated.ts:44-53`; `T/providers/builtin.test.ts:91-106`.
- F31. Firecrawl and Jina are not subject to this check; they call a vendor API and the target is
  fetched by the vendor. `I/public-url.ts:6-9`; `packages/tools/README.md` ("Hosted providers are unaffected").
  Whether the vendor refuses private addresses is the vendor's behavior and not documented here.
- F32. To read an intranet page on purpose, do it in your own handler rather than through this tool.
  `packages/tools/README.md` ("Public addresses only").
- F33. Known limit: the check resolves the hostname and the connection resolves it again, so a hostile DNS
  server that answers differently each time is not covered. `I/public-url.ts:10-17`;
  `packages/tools/README.md` ("a hostile DNS server...").

## What comes back on a failed fetch (sitemap question 2)

- F34. A failed fetch throws a `FlowError`; it is not returned as a result. The call does not produce a
  `FetchResult` with an error field. `F/errors.ts:208-295`; `T/errors.test.ts:70-92`.
- F35. The error carries `code`, `retryable`, `details`, and sometimes `cause`. `details.errorType` is one
  of `"http" | "network" | "timeout" | "abort" | "parse" | "blocked" | "unknown"`. `F/errors.ts:137-144`.
  The existing user docs list six (no `"blocked"`), and `apps/docs/docs/advanced/error-handling.md:61`
  lists six; both are out of date against the code.
- F36. The five error shapes (message, `code`, `retryable`, `details`):
  | Case | `code` | `retryable` | `details` |
  | --- | --- | --- | --- |
  | Non-2xx response | `fetch_http_error` | true for 5xx, 429 and 408; false otherwise | `errorType: "http"`, `httpStatus`, `httpStatusText`, `responseBody` (only when non-empty), `url` |
  | Transport failure (DNS, socket, TLS, timeout, abort, too many redirects) | `fetch_transport_error` | true when `errorType` is `"network"` or `"timeout"` | `errorType`, `url`; the original error on `cause` |
  | Blocked URL (built-in only) | `fetch_blocked_url` | false | `errorType: "blocked"`, `url`; original on `cause` |
  | Firecrawl reports `success: false` | `fetch_provider_error` | false | `errorType: "unknown"`, `url` |
  | Named provider has no key | none (plain `Error`) | n/a | none |
  Evidence: `F/errors.ts:208-230` (http), `238-252` (transport), `263-274` (blocked), `286-295` (provider);
  `F/resolver.ts:319`.
  Messages: `<provider> fetch failed: <status> <statusText> for <url>`; `<provider> fetch failed (<errorType>) for <url>`;
  `<provider> fetch blocked: <reason>`; `<provider> fetch failed: <message> for <url>`.
- F37. 429 and 408 are retryable, as well as 5xx. The existing page's table and the README say only
  "5xx / network / timeout". Code and test win: `F/errors.ts:214-215`; `T/errors.test.ts:110-124`.
- F38. A 403 (bot wall) is not retryable and `responseBody` holds the wall's text. `T/errors.test.ts:70-92`.
- F39. `responseBody` is the response text capped at 1000 characters, with `…[truncated]` appended when
  cut; `""` if the body cannot be read, in which case the key is omitted. `F/errors.ts:146-147,194-201,225`;
  `T/errors.test.ts:50-61`.
- F40. For a non-2xx response the `url` in `details` is the final URL after redirects (built-in) and the
  requested URL (Jina). `F/providers/builtin.ts:31-36`; `F/providers/jina.ts:24`.
- F41. Classification of a transport failure: `AbortError` or code `UND_ERR_ABORTED`/`ABORT_ERR` is
  `"abort"`; `TimeoutError` or a code containing `TIMEOUT` or `ETIMEDOUT` is `"timeout"`; any other code
  found on the cause chain (`ENOTFOUND`, `EAI_AGAIN`, `ECONNRESET`, `ECONNREFUSED`, TLS codes) is
  `"network"`; no code is `"unknown"`. `F/errors.ts:169-187`; `T/errors.test.ts:9-48`.
  `"parse"` is defined but no bundled provider produces it (`F/errors.ts:173-176`); do not promise it.
  A transport failure with no code classifies as `"unknown"`, which is not retryable.
- F42. A DNS failure during the built-in provider's address check is a normal retryable `"network"`
  error, not `"blocked"`. `F/providers/builtin.ts:21-27`; `T/providers/builtin.test.ts:160-175`;
  `packages/tools/README.md`.
- F43. Reading it in code: `error instanceof FlowError` and `error.details?.httpStatus`; `FlowError` is
  exported from `@flow-state-dev/core`. `apps/docs/docs/tools/fetch.md` (error-handling example);
  `apps/docs/docs/advanced/error-handling.md:11`.
- F44. What the model sees when the tool throws inside a generator: UNVERIFIED for the live tool loop
  from public evidence. The only readable evidence is the resume path, which hands the model a tool
  result of type `error-text` built from the error's `message` (`packages/core/src/blocks/generator.ts:1746,1825`,
  via `failedToolResultText`). Do not write what the model reads on a live failure until a generator
  test or a run shows it. Suggest the writer asks for it, or runs `fsdev run` with a flow that fetches
  `http://127.0.0.1`.
- F45. Retry: tool retry is OFF unless the flow sets a retry policy in `tools.defaults.retry`
  (`maxAttempts`, `baseDelayMs`, `maxDelayMs`, optional `retryableErrors`). It filters by error class
  (`retryableErrors`), not by `FlowError.retryable`. `packages/core/src/blocks/internal/tool-executor.ts:81,405-453`.
  So the existing page's claim that "a generator's built-in retry reads this, so transient server
  failures are backed off for you without any extra wiring" is NOT supported by what I read. The
  `retryable` flag is a field callers can read; do not state that the framework retries on it.
  Flag for the caller.

## How it pairs with search (sitemap question 3)

- F46. Search returns titles, URLs and snippets; fetch reads one URL's full page. Search's description:
  "Returns titles, URLs, and snippets from web pages matching the query." Fetch's description says to
  use it "to read the full content of a URL found via search or provided by the user."
  `packages/tools/src/search/index.ts:40-41`; `F/index.ts:21-23`.
  (Search result shape: see `search.facts.md`.)
- F47. Pairing is two entries in one `tools` array: `tools: [tools.search(), tools.fetch()]`. The model
  decides when to call each; there is no wiring between them. `apps/docs/docs/tools/fetch.md` ("Composing
  with search"). The two blocks have different names (`search`, `fetch`), so they do not collide.
  `apps/docs/docs/fundamentals/blocks.md:184` (tool names must be unique within one generator).
- F48. Asymmetry on keys: search throws when no provider key is found; fetch never does when unnamed.
  So a generator with both can fetch with zero keys but needs a search key. `F/resolver.ts:338-339`;
  `apps/docs/docs/tools/fetch.md:69`; see `search.facts.md` F13 and the search resolver.
- F49. Fetch takes whatever string the model gives as `url`; it does not validate that it came from a
  search result. Restricting what the model may read is done by wrapping the block: the kitchen-sink
  example routes through a host check and returns `{ refused: "..." }` for any other host, so nothing is
  requested. `apps/kitchen-sink/workforce/teams/support/workers/fsd/blocks/fetch.ts:20-57`.
  This is the one worked example of guarding the tool; it uses `router`, `handler`, `fetchInputSchema`,
  `fetchResultSchema` from `@flow-state-dev/core` and `@flow-state-dev/tools/fetch`.
- F50. Each page fetched returns its whole Markdown into the model's context; there is no length
  limit or truncation on `markdown` in the tool. (No `slice`/limit in `F/index.ts` or the three
  adapters.) Whether the model's context can hold it is the caller's concern. Verified by absence:
  `F/index.ts:26-32`, `F/providers/*.ts`.

## Not Fetch (do not put on this page)

- Multi-page: `tools.crawl()` (K-32). Link, one clause.
- Provider env-var tables for search; Perplexity/Sonar order. Those are on Search.
- Block/handler/generator definitions: defined on their own pages; this page says a tool is a block a
  generator can call and links.

## Existing-docs claims the page should not repeat (code or tests disagree or are silent)

1. "Jina Reader ... Yes (ReaderLM) JS rendering", "`waitForJS` ... Firecrawl and Jina": F25.
2. "works without key at 20 RPM": F13.
3. Sample output with `publishedDate`: F20.
4. "5xx, network, timeout are retryable; 4xx is not": F37 (adds 429, 408).
5. `errorType` list without `"blocked"`: F35.
6. "a generator's built-in retry reads this": F45.
7. "Firecrawl API error: Throws with the Firecrawl error message" (OK) but "No (fails fast)": matches F36.
8. "This is the same pipeline Jina Reader uses internally": no evidence in code; leave out.
9. "Follows redirects automatically (standard fetch behavior)": for built-in it is a hand-rolled
   5-hop loop with a per-hop address check (F26, F30); Jina and Firecrawl redirect behavior is the
   vendor's.

## Revisions (pass 8, round 2)

- Verified: a 403 carries `retryable: false` (`T/errors.test.ts:70-92`), so the table row stands; `FlowError.details` is `Record<string, unknown>` (`packages/core/src/errors/flow-error.ts:41`), so `error.details?.httpStatus === 404` type-checks.
- The page's `builtinFetch()` example is named `readDirect`; F15 wording "never calls an outside service" is about the page content only. The page says the built-in provider fetches the page itself and never sends it to a hosted provider; it does make a network request to the target site.
- The page links the error contract to `reference/errors` (R-22).
