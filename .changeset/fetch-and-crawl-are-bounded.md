---
"@flow-state-dev/tools": minor
---

The built-in `fetch` and `crawl` tools are bounded (FIX-2821).

- **Breaking: the app's crawl limits are ceilings.** `crawl({ maxPages, maxDepth })` now sets the most one crawl may visit (default 20 pages, depth 2). The model can ask for less in the tool call, never more. Before, the input schema filled in 20 and 2 and the config values were never used, so a model (or a crawled page steering it) could ask for any number. The tool input's `maxPages` and `maxDepth` are now optional, with no default, so the crawl tool's input JSON schema no longer has `default` on either field and `CrawlInput` types them as optional.
- **Time limit.** A built-in fetch, and each page a built-in crawl reads, has 30 seconds for every redirect hop and the body together. Running out throws `fetch_transport_error` with `errorType: "timeout"` (retryable). Cancelling the run aborts the request (`errorType: "abort"`) and ends a crawl.
- **Size limit.** A body is streamed and cut off past 5 MiB. The fetch tool throws the new `fetch_response_too_large` code, `errorType: "too_large"`, not retryable. A crawl skips that page. A non-2xx response keeps its `fetch_http_error` and retry choice even when its body is too large to read; only the body excerpt is dropped. A crawl does not read the body of a page it skips for its status or content type.
- **DNS rebinding is closed.** A hostname is resolved once, when the socket connects, and refused unless every address is public; the connection uses that answer. A name that answers public to one lookup and private to the next can no longer reach a private address. The refusal is `fetch_blocked_url`, as before.
- `FetchProviderAdapter` and `CrawlProviderAdapter` options gain an optional `signal`.

Docs: apps/docs/docs/reference/tools.md (fetch: the rebinding caveat goes, add the time and size limits and the `too_large` row; crawl: `maxPages`/`maxDepth` are ceilings set in config, drop the "config values never apply" note) and apps/docs/docs/reference/errors.md (list `fetch_response_too_large`).
