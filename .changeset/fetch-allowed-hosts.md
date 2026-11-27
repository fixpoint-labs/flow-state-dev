---
"@flow-state-dev/tools": minor
---

The `fetch` and `crawl` tools take an `allowedHosts` option (FIX-2747).

- `fetch({ allowedHosts: ["docs.example.com"] })` and `crawl({ allowedHosts })` limit the tool to those hostnames. The list is checked on the URL the model asks for and on every redirect hop, so an allowed site can no longer redirect the tool to any other public host. Hosts match exactly: `example.com` does not allow `www.example.com`.
- A refusal is `fetch_blocked_url` (not retryable), and its message names the host and the hop: the starting URL or `redirect hop <n>`. A crawl skips a refused page.
- Only the built-in provider can check redirect hops, so setting `allowedHosts` selects it even when a Firecrawl or Jina key is set, and naming a hosted provider with `allowedHosts` throws.
- Unset, nothing changes.

Docs: apps/docs/docs/reference/tools.md (fetch and crawl config tables gain `allowedHosts`; the fetch network section says the list is checked on every hop and selects the built-in provider).
