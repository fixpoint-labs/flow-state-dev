---
title: Crawl
type: catalog
description: Follow links from a root URL and return each page.
---

# Crawl

`@flow-state-dev/tools` gives a model a tool that starts at one URL, follows links to other pages on the same site, and returns each page as markdown. Use it when a question needs a whole documentation set or knowledge base, not one page. For a single page, use [Fetch](./fetch.md).

## Install it

Crawl comes with `@flow-state-dev/tools`. The built-in crawler needs no key. Set `FIRECRAWL_API_KEY` and install `@mendable/firecrawl-js`, and the same tool runs on Firecrawl instead, which can wait for JavaScript to render. The [Tools reference](../../reference/tools.md) compares the two providers.

## Use it

Add `tools.crawl()` to a generator's `tools` list. The model supplies the root URL and, if it wants, `maxPages` (default 20) and `maxDepth` (default 2).

```ts title="src/flows/research/blocks/docs-crawler.ts"
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

export const docsCrawler = generator({
  name: "docs-crawler",
  model: "openai/gpt-6-luna",
  prompt: "Crawl documentation sites and build a knowledge summary.",
  tools: [tools.crawl()],
});
```

The tool returns the root URL, a `pages` array, `totalPages` and `crawlDepth`. Each page has the same shape as a Fetch result: `url`, `title`, `markdown`, `metadata` and `source`. The Tools reference lists every field.

A crawl returns all its pages in one result, so a large `maxPages` puts that much markdown into the model's context.

## Keep it to part of a site

URL patterns are the developer's boundary. The model cannot change them. Set them when you build the tool:

```ts title="src/flows/research/blocks/api-docs-crawler.ts"
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

export const apiDocsCrawler = generator({
  name: "api-docs-crawler",
  model: "openai/gpt-6-luna",
  prompt: "Read the API documentation and answer questions about it.",
  tools: [
    tools.crawl({
      includePatterns: ["/docs/**", "/api/**"],
      excludePatterns: ["/docs/changelog/**"],
    }),
  ],
});
```

Patterns are globs matched against the URL path only, not the host or query string, and an exclude pattern wins over an include. A pattern must match the whole path: `/docs/**` matches `/docs/api/ref` but not `/docs` itself, because it needs the slash. The built-in crawler checks patterns before it fetches a page, and that includes the root URL. An include list that does not match the root's path returns no pages, so start the crawl at a URL under the include path. Firecrawl receives the same strings as its include and exclude paths and does its own matching, so globs may not carry over. The Tools reference has the glob rules.

## Combine it with search and fetch

Give the model all three tools and say in the prompt when to use each one.

```ts title="src/flows/research/blocks/researcher.ts"
import { generator } from "@flow-state-dev/core";
import { tools } from "@flow-state-dev/tools";

export const researcher = generator({
  name: "researcher",
  model: "openai/gpt-6-luna",
  prompt: `You are a research assistant.
Use search to find relevant sources.
Use fetch to read individual pages in full.
Use crawl when you need to understand an entire site or documentation set.`,
  tools: [tools.search(), tools.fetch(), tools.crawl()],
});
```

## Change the provider

With no `provider` set, Crawl uses Firecrawl when a key is found in config or `FIRECRAWL_API_KEY`, and the built-in crawler otherwise. Pass `provider: "builtin"` or `provider: "firecrawl"` to force one. Forcing Firecrawl with no key throws when the tool is called. `waitForJS: true` makes Firecrawl wait for scripts to run, and the built-in crawler ignores it. The `firecrawlCrawl` and `builtinCrawl` constructors, and the full options table, are in the Tools reference.

## What the built-in crawler won't do

It reads the HTML the server sends and follows same-origin links, one request per second. It is enough for static sites such as documentation, blogs and wikis.

- **JavaScript-rendered pages**: it returns whatever the server sends as HTML.
- **Authentication**: it sends no cookies and keeps no session.
- **robots.txt**: not read. The crawler ignores it.
- **Other origins**: links to another host, port, scheme or subdomain are not followed. `https://blog.site.com/...` is not followed from `https://site.com`.
- **Non-web links**: only `http` and `https` links are followed, so `mailto:` is skipped. A `#fragment` is dropped before the link is checked, so `/docs#intro` is the page `/docs`, which is then tested against your patterns like any other path.
- **Local and private hosts**: it refuses `localhost` and any host that resolves to a private address, before it connects. Pointing it at `http://localhost:3000/docs` makes no request and returns `pages: []` with no error. Firecrawl is not blocked by that check, but it runs on the vendor's service, not on your network, so it cannot reach your localhost either. Test against a deployed or public copy of the site.
- **Non-HTML responses**: PDFs and images are skipped.

A page that fails to load is skipped and the crawl continues. That includes the root URL: a root that fails, or one that is refused as above, gives `pages: []`, not an error. An invalid URL string throws, and so does any Firecrawl failure.

## Next

- [Fetch](./fetch.md): read a single page.
- [Tools](./index.md): every tool in the package.
- [Tools reference](../../reference/tools.md): providers, options, output fields, pattern rules and errors.
