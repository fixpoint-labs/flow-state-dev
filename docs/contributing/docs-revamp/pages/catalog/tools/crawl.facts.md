# Fact sheet: Crawl (K-32, `catalog/tools/crawl`)

Sources cited: the exported surface and doc comments in `packages/tools/src/crawl/`, the shared
helpers it calls in `packages/tools/src/_internal/`, its tests in `packages/tools/test/crawl/`, the
existing user docs (`apps/docs/docs/tools/crawl.md`, `apps/docs/docs/tools/overview.md`,
`packages/tools/README.md`), and one example (`apps/kitchen-sink/flows/chat-agent/shared/capabilities/features.ts`).
Paths are relative to the repo root; `C/` abbreviates `packages/tools/src/crawl/`, `T/` abbreviates
`packages/tools/test/crawl/`, `I/` abbreviates `packages/tools/src/_internal/`. No spec is cited.

## Stored data: the four questions

The tool stores nothing. It declares no resource, collection, or state, and each call returns a
`CrawlResult` and keeps nothing between calls. Owner, visibility, location and count do not apply.
(The block call's recorded input and output are the framework's, for every block, and not Crawl's to
document.) API keys come from the config object or the host's environment, never framework state.
Evidence: `C/index.ts:91-111` (the whole `execute`), `C/resolver.ts:40-46` (key read from config
or `process.env`).

## What it is

- F1. `crawl` is a handler block named `crawl`, built to go in a generator's `tools` list.
  `C/index.ts:91-93`; `T/crawl.test.ts:73-79` (`name` is `"crawl"`, `kind` is `"handler"`).
- F2. Its model-facing description: "Crawl a website starting from a root URL, following links up to
  a specified depth. Returns markdown content for each page found. Use this for site-wide content
  ingestion." `C/index.ts:94-96`.
- F3. Reachable as `tools.crawl(...)` and `crawl` from `@flow-state-dev/tools`, and as `crawl` from
  the subpath `@flow-state-dev/tools/crawl`. `packages/tools/src/index.ts:6,26`;
  `packages/tools/package.json` (`./crawl` export); example import
  `apps/kitchen-sink/flows/chat-agent/shared/capabilities/features.ts:23`. `tools.crawl()` and
  `crawl()` return the same kind of block. `T/crawl.test.ts:81-86`.
- F4. `crawl(config: CrawlConfig = {})`, so a call with no argument is valid.
  `C/index.ts:91`. Example: `const crawlTool = crawl();` `features.ts:47`.
- F5. Two providers: `firecrawl` and `builtin`. `C/types.ts:6` (`crawlProviders`).
- F6. Two locked constructors take `CrawlConfig` minus `provider`: `firecrawlCrawl(config)` and
  `builtinCrawl(config)`. Both return the same `crawl` block with `provider` set. `C/index.ts:114-120`.
  Both are also exported from the package root. `packages/tools/src/index.ts:27-30`.

## How do you bound a crawl? (sitemap question 1)

- F7. Two limits, both numbers. `maxPages`, "Maximum number of pages to crawl", default 20.
  `maxDepth`, "Maximum link-following depth from root URL", default 2.
  `C/types.ts:23-33` (input schema), `C/types.ts:42-45` (config, same defaults in doc comments).
- F8. Both are fields of the tool's input schema, so the model can pass them on each call, and both
  are also config fields you set when you build the tool. `C/types.ts:23-33,39-45`;
  `C/index.ts:102-103`.
- F9. Which one wins. The input schema carries `.default(20)` and `.default(2)`, so when the model
  omits a limit, the schema supplies 20 or 2 before `execute` sees it. Observed in `runForTest`
  (scratch run, not a committed test): `crawl({ maxPages: 50, maxDepth: 3 })` called with only
  `{ url }` reached the provider with `maxPages: 20, maxDepth: 2`. So the config values do not act
  as defaults the model's omission falls back to; they apply only if the input carries no value at
  all, which the schema default prevents. `C/types.ts:25-32`, `C/index.ts:102-103`
  (`input.maxPages ?? config.maxPages ?? 20`). **Conflict with the existing page**
  (`apps/docs/docs/tools/crawl.md`: "Default limits (LLM can override per call)", and the table "config
  sets default, LLM can override"). Verified only through the `runForTest` harness. The engine's own
  input parsing was not found in the files read (`packages/engine/src/execution/runAction.ts` and
  `runView.ts` parse their own input). Writer: either state "the model's value wins; if it passes
  none, 20 and 2 apply" after the caller confirms engine behaviour, or leave config limits out of the
  page. Do not claim config limits are defaults.
- F10. The test that claims "input values take precedence over config" only asserts the result is
  defined, so it does not pin F9 either way. `T/crawl.test.ts:111-120`.
- F11. `maxPages` counts pages actually returned, not links seen. The built-in loop runs while
  `pages.length < maxPages`, and a page is pushed only after a successful, HTML response. A failed or
  non-HTML fetch does not use up a page. `C/providers/builtin.ts:65,102-112`. Test:
  `T/providers/builtin.test.ts:314-340` (`maxPages: 2` returns 2 pages of 4 reachable).
- F12. `maxDepth` counts link hops from the root. The root is depth 0. Links are queued only from a
  page whose depth is below `maxDepth`. So `maxDepth: 0` returns the root only; `maxDepth: 1` returns
  the root and the pages it links to. `C/providers/builtin.ts:62,115-122`. Tests:
  `T/providers/builtin.test.ts:258-276` (`maxDepth: 0`, one page), `278-312` (`maxDepth: 1`, two of
  three chained pages).
- F13. Order is breadth-first: a queue taken from the front, with new links appended at the back.
  Every page at depth 1 is tried before any at depth 2. So when `maxPages` cuts the crawl short, the
  pages left out are the deepest ones. `C/providers/builtin.ts:62,66,119`.
- F14. Pause between requests. The built-in crawler waits 1000 ms before every fetch after the first
  page has been returned. `C/providers/builtin.ts:83-86`. Subtlety: the wait is skipped while no page
  has yet been returned and applies before each later attempt, including ones that then fail. A
  crawl of N pages takes at least N-1 seconds. No option changes the delay.
  Firecrawl does not use this delay. `C/providers/firecrawl.ts` (no delay).
- F15. The result reports `crawlDepth` as the configured `maxDepth`, not the deepest level actually
  reached. `C/providers/builtin.ts:133`; `C/providers/firecrawl.ts:252`. `totalPages` is the length of
  `pages`. `builtin.ts:132`.
- F16. Duplicates. A URL is visited at most once. Before the visit check, fragment (`#...`) is removed
  and one trailing slash is stripped from paths longer than `/`. So `/docs` and `/docs/` and
  `/docs#intro` are one page. `C/providers/builtin.ts:67-70,139-146`. Query strings are not stripped, so
  `/page?a=1` and `/page?a=2` are different pages. `builtin.ts:139-146`.
- F17. `waitForJS` is a config field only (not in the input schema), default false. With Firecrawl it
  sets `scrapeOptions.waitFor` to 5000 ms. The built-in crawler ignores it. `C/types.ts:50-51`;
  `C/providers/firecrawl.ts:229-232`; `C/providers/builtin.ts` (no reference to `waitForJS`).
  Test: `T/providers/firecrawl.test.ts` ("passes include/exclude patterns to SDK",
  `waitFor: 5000`).

## Which URLs are followed? (sitemap question 2)

- F18. The built-in crawler follows only same-origin links: scheme, host and port must equal the root
  URL's. Other origins (including a subdomain) are dropped. `C/providers/builtin.ts:116,148-171`
  (`resolved.origin === origin`). Test: `T/providers/builtin.test.ts:395-408` (`other.com` link
  dropped).
- F19. Links are found by scanning `<a href="...">` tags in the page HTML. Relative links resolve
  against the page's URL, fragments are removed, and links that are not http(s) (such as `mailto:`)
  or that fail to parse are skipped. `C/providers/builtin.ts:153-169`. Tests: `T/providers/builtin.test.ts:410-428`
  (hash stripped, `../other` resolved). Only `<a>` tags are read; no sitemap, `<link>`, or script
  URLs. The scan runs on the raw HTML, so links a script adds after load are not seen
  (`builtin.ts:99,116`).
- F20. A page is returned only if the response is OK (`response.ok`) and the content type contains
  `text/html`. Other responses (PDF, images, error statuses) are skipped silently, and their links
  are not followed. `C/providers/builtin.ts:94-97`. Test: `T/providers/builtin.test.ts:342-368`
  (PDF skipped).
- F21. A page that fails (network error, blocked URL, non-OK status) is skipped and the crawl goes
  on. `C/providers/builtin.ts:123-126`. Test: `T/providers/builtin.test.ts:370-392`.
- F22. Patterns. `includePatterns` and `excludePatterns` are lists of globs, config fields only
  (not in the input schema, so the model cannot change them), matched against the URL's path
  (`new URL(url).pathname`), not the full URL. Query strings and the host are not part of the match.
  `C/types.ts:46-49`, `C/providers/builtin.ts:173-186`.
- F23. Glob rules: `**` matches anything including `/`; `*` matches within one path segment (no `/`);
  `?` matches one character that is not `/`. The pattern must match the whole path. `/docs/*` matches
  `/docs/page1` and not `/docs/sub/page`; `/docs/**` matches `/docs/api/ref`; `/about` does not match
  `/about-us`. `C/providers/builtin.ts:188-195`. Tests: `T/providers/builtin.test.ts:462-477`.
  Gotcha: `/docs/**` requires the slash, so it does not match `/docs` itself. Derived from the regex
  `^/docs/.*$` (`builtin.ts:189-194`); no test pins it. Other regex characters in a pattern (for
  example `.` or `(`) are not escaped and act as regex, `builtin.ts:189-194`. Do not document beyond
  `*`, `**`, `?`.
- F24. Exclude wins. A path matching any exclude pattern is dropped. If include patterns exist, a
  path must match at least one. With neither list, everything same-origin passes.
  `C/providers/builtin.ts:178-185`. Test: `T/providers/builtin.test.ts:431-460` (including "exclude
  takes precedence over include").
- F25. A page that fails the patterns is not fetched and its links are not followed. So an include
  list that does not match the root path yields no pages at all, since the root itself is checked.
  `C/providers/builtin.ts:72-80` (check runs before the fetch, on every queue entry including the root).
  The page's links are only queued after a successful fetch (`builtin.ts:115-122`), so a page that is
  excluded cannot lead to pages behind it. Derived from code; no test checks the root-excluded case.
  Consequence for a reader: an include like `["/docs/**"]` with root `https://site.com/` returns nothing.
  Start the crawl at a URL under the include path.
- F26. Not followed, by policy: the built-in crawler checks every queued URL and every redirect hop
  against a public-address rule before it opens a connection. Refused: non-http(s) schemes, URLs with
  a username or password, `localhost` and `*.localhost`, and any host that resolves to a non-public
  address (loopback, private ranges 10/8, 172.16/12, 192.168/16, link-local 169.254/16 which includes
  cloud metadata, CGNAT, multicast and reserved, and the IPv6 equivalents). If any address a name
  resolves to is private, it is refused. `I/public-url.ts:47-91,101-119`; `I/fetch-validated.ts:41-68`.
  Test: `T/providers/builtin.test.ts:486-532` (private root requested: no fetch call, `pages` empty;
  public page linking to `http://127.0.0.1/` is never requested). (Note that same-origin already keeps
  a link to `127.0.0.1` off a public root; the check matters when the root itself is internal or a
  redirect leads inward.)
- F27. Redirects are followed by hand, at most 5, each hop re-checked. Beyond 5 the page fails and is
  skipped. `I/fetch-validated.ts:16,55-67`. A redirect to another origin is allowed to be fetched (the
  same-origin rule applies only to discovered links, not redirect targets), as long as it is public.
  Derived from code (`builtin.ts:92` fetches `entry.url` with `fetchValidated`, no origin check on
  `finalUrl`); no test.
- F28. A blocked or private root does not throw. The result is `pages: []`, `totalPages: 0`.
  `T/providers/builtin.test.ts:486-499`. **Conflict with the existing page**
  (`apps/docs/docs/tools/crawl.md`, "Error handling": "Root URL fails | Throws an error"). For the
  built-in crawler, an unreachable, blocked, non-HTML or non-OK root yields an empty `pages` array,
  because every failure is caught per page (`builtin.ts:123-126`). The code wins. For Firecrawl, errors
  from the SDK propagate (no catch in `C/providers/firecrawl.ts:218`), so a failed Firecrawl crawl
  throws.
- F29. The built-in request carries the headers `User-Agent: Mozilla/5.0 (compatible;
  FlowStateDev/1.0)` and `Accept: text/html,application/xhtml+xml`. No cookies, no auth.
  `I/fetch-validated.ts:47-53`. robots.txt is not read: no code path references it
  (`C/providers/builtin.ts` complete). Existing page says the same ("not respected").
- F30. Page content. The built-in crawler converts each page to markdown with Readability to pick the
  main article, then Turndown to convert it, falling back to the whole `<body>` when Readability finds
  no article. Title is the article title, else the document title. `I/html-to-markdown.ts:19-45`. So
  navigation, footers and sidebars are usually dropped from `markdown`. (Behaviour of Readability on
  a given page is not pinned by a test here.)
- F31. Firecrawl followed URLs are decided by Firecrawl, not by this code. This package passes
  `limit` (from `maxPages`), `maxDepth`, `includePaths`, `excludePaths` (each omitted when the list
  is empty), and `scrapeOptions: { formats: ["markdown"], waitFor }`. `C/providers/firecrawl.ts:218-233`.
  Test: `T/providers/firecrawl.test.ts` ("passes include/exclude patterns to SDK"). Whether Firecrawl
  reads those patterns as globs or regex, whether it stays on the root's domain, and its rate and
  rendering behaviour are not visible in this repo. The existing page says "Regex patterns" for
  Firecrawl; the code only passes the strings through, so that is unverifiable here. Writer: say
  patterns are passed to Firecrawl as given and link out, or cut it. Do not claim a syntax.

## When should you use a provider instead of the built-in crawler? (sitemap question 3)

- F32. With no `provider`, a key is looked up in `config.keys.firecrawl`, then `FIRECRAWL_API_KEY`.
  If one is found, Firecrawl is used; otherwise the built-in crawler. Auto-selection never throws.
  `C/resolver.ts:9-11,31-37,40-46`. Tests: `T/resolver.test.ts:207-227`; `T/crawl.test.ts:88-109`.
- F33. `provider: "builtin"` (or `builtinCrawl()`) never reads a key, even when `FIRECRAWL_API_KEY` is
  set. `C/resolver.ts:18-20`. Test: `T/resolver.test.ts:199-204`.
- F34. `provider: "firecrawl"` (or `firecrawlCrawl()`) with no key throws, at call time not at
  construction: `Crawl provider "firecrawl" requested but no API key found. Set FIRECRAWL_API_KEY or pass
  it via config.keys.firecrawl`. `C/resolver.ts:21-27`. Tests: `T/resolver.test.ts:193-197`;
  `T/crawl.test.ts:149-157` (`firecrawlCrawl()` builds fine, run rejects). Provider is chosen on
  each call: setting the env var after the tool is built still takes effect (`C/index.ts:100` runs
  `resolveProvider` inside `execute`).
- F35. Firecrawl needs the `@mendable/firecrawl-js` package installed, an optional peer dependency.
  If it is missing the call throws "Install @mendable/firecrawl-js to use the Firecrawl crawl provider:
  npm install @mendable/firecrawl-js". `C/providers/firecrawl.ts:204-213`;
  `packages/tools/README.md` (Providers table). Check the exact peer declaration in
  `packages/tools/package.json` before stating "optional peer".
- F36. Firecrawl runs the crawl on its service; the SDK call waits until it completes (the code comment
  says the SDK polls internally). `C/providers/firecrawl.ts:217-218`. Firecrawl pages report
  `contentType: "text/html"` and `statusCode` from the response metadata or 200, whatever the real
  page, and `title` and `markdown` fall back to empty strings. `C/providers/firecrawl.ts:235-246`.
  A page's `url` falls back to the root URL when the page carries no source URL. `firecrawl.ts:236`.
- F37. The public-address rule (F26) applies to the built-in crawler only. Hosted providers are exempt
  because they call a vendor API and the target is not requested from your server. `I/public-url.ts:4-8`.
  Consequence: the built-in crawler cannot crawl an intranet or `localhost` site; Firecrawl cannot
  reach one either (it is not on your network) but is not blocked by the check. Do not claim Firecrawl
  can crawl private hosts. Only the first half is shown by code.
- F38. What the built-in crawler cannot do, from code: no JavaScript rendering (reads the HTML the
  server sends, `builtin.ts:99-100`), `waitForJS` ignored (F17), no cookies or authentication
  (headers in F29 only), no robots.txt (F29), sequential one-page-at-a-time with a fixed 1 s pause
  (F14), same-origin only (F18). The existing page and README make the same claims. "Anti-bot
  protection" blocks (existing page) are not shown by code; do not state as fact.
- F39. The existing page recommends Firecrawl for production crawling and the built-in crawler for
  development. That is the page's advice (`apps/docs/docs/tools/crawl.md`, "Limitations of the
  built-in crawler"), not behaviour. If kept, phrase as a recommendation. The README says the built-in is
  a "BFS crawler with Readability + Turndown" and "Always works".

## What comes back

- F40. `CrawlResult`: `rootUrl` (the URL you passed, unchanged), `pages` (array), `totalPages`
  (number), `crawlDepth` (number, see F15), `source` (`"firecrawl"` or `"builtin"`).
  `C/types.ts:11-17`. Exported as the schema `crawlResultSchema` and the type `CrawlResult`
  (`C/index.ts:122-130`; root `packages/tools/src/index.ts:66-72`).
- F41. Each entry in `pages` has the same shape as a Fetch result: `url`, `title`, `markdown`,
  `metadata` (`statusCode`, `contentType`, optional `description`, optional `publishedDate`,
  `wordCount`), and `source`. `C/types.ts:13` (uses `fetchResultSchema`);
  `packages/tools/src/fetch/types.ts:10-22`.
- F42. Built-in pages set `url` to the queued URL (after fragment removal, before slash trimming),
  `statusCode` to the HTTP status, `contentType` to the header value, `wordCount` from the markdown,
  and no `description`. `C/providers/builtin.ts:102-112`.
- F43. A crawl returns all pages in one result; there is no streaming or paging. `C/types.ts:11-17`.
  Output size therefore grows with `maxPages` and page length. The block's call is recorded by the
  framework (see best practice for large returns); do not document recording here. The practical
  consequence for the reader: a large `maxPages` puts that much markdown into the model's context.
  Derived, no test.

## The one example the page can use

- F44. The only in-repo use is `apps/kitchen-sink/flows/chat-agent/shared/capabilities/features.ts`:
  `crawl()` with no config is built at module level (line 47), added to a skills catalog (line 70),
  and pushed into a tools list when a per-request feature flag is on (line 187). It shows no pattern
  config. Existing docs show a generator with `tools: [tools.crawl()]` and
  `tools: [tools.crawl({ maxPages: 30, maxDepth: 2 })]`. `apps/docs/docs/tools/crawl.md`;
  `apps/docs/docs/tools/overview.md`. The page's "`crawl` with a pattern" example (sitemap) must be
  written against `CrawlConfig`: `crawl({ includePatterns: ["/docs/**"], excludePatterns: ["/docs/changelog/**"] })`.
  The type accepts it (`C/types.ts:46-49`). No test calls the full `crawl` block with patterns; the
  pattern matching is tested on `matchesPatterns` and the adapter alone.

## Known contradictions to settle before the page states them

1. Config `maxPages`/`maxDepth` as defaults the model overrides: F9. Observed to be overridden by the
   schema default when the model omits them. Needs a caller decision.
2. "Root URL fails: throws": F28. The code returns an empty result for the built-in crawler.
3. "Regex patterns" for Firecrawl: F31. Not verifiable from this repo.
4. Existing page table row "Page limits: Yes / URL filtering" lists Firecrawl as regex and the built-in
   as glob. Only the built-in half is shown by code.
5. The existing page's "Firecrawl timeout: SDK handles polling internally" and "Infinite
   calendar/pagination: `maxPages` limit prevents runaway" are mechanism and a claim about
   pagination traps. The second holds for the built-in crawler only if the pages return OK HTML and
   `maxPages` counts successes (F11); failures do not count toward `maxPages`, so a trap of failing
   URLs is bounded by `maxDepth` and the visited set instead. Do not repeat it as written.
6. The existing "Direct provider constructors" snippet imports from the package root; both root and
   `/crawl` subpath exports exist (F3, F6), so both forms are valid.

## Left out (no observable surface, or not for this page)

- Provider adapter interface (`CrawlProviderAdapter`), `getAdapter`, `ENV_VAR_MAP`, `extractLinks`,
  `globMatch`, `matchesPatterns` as internals: exported from `C/index.ts` or the provider modules but
  not from the package root (only the types `CrawlProviderAdapter` is re-exported from `crawl/index`,
  `C/index.ts:122-128`). Reference material at most.
- DNS rebinding limit (`I/public-url.ts:10-16`): internals; a Reference row at most.
- The exact private-range list beyond the summary in F26.

## Revise round 1: what the page now states

- F45. The page no longer states config `maxPages`/`maxDepth` as defaults (F9). It says the model
  can pass either per call, defaults 20 and 2, and its examples set neither in config.
- F46. Patterns: glob rules and the empty-list defaults moved to Reference R-42. The page states
  exclude-wins (F24), checked before fetch including the root (F25), and that Firecrawl gets the
  same strings and matches them itself (F31). No Firecrawl syntax is claimed.
- F47. Errors: a failed root gives `pages: []` for the built-in crawler (F28). An invalid root URL
  string throws (`C/providers/builtin.ts:14`, `new URL(rootUrl)`), and Firecrawl SDK errors
  propagate (F28). The "Firecrawl timeout" row is cut: no observable timeout behaviour in the code.
- F48. The page does not claim anti-bot handling for Firecrawl (F38: not shown by code); it says only that Firecrawl can wait for JavaScript (F17).

## Revise round 2: what the page now states

- F49. Patterns match the path only and need the whole path to match; `/docs/**` does not match `/docs` (F22, F23). Stated on the page as a one-line gotcha, with the full glob rules still in Reference.
- F50. Followed links: same origin only (scheme, host, port; a subdomain is another origin), http(s) only, fragment dropped before the pattern check (F16, F18, F19, F24). Worked case: with `/docs/**` and exclude `/docs/changelog/**`, only `/docs/api/ref` of the five links is followed.
- F51. `localhost` and private hosts are refused before connecting; the built-in result is `pages: []` with no error. Firecrawl is not blocked by the check but cannot reach your network (F26, F28, F37).
