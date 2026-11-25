import type { CrawlProviderAdapter, CrawlResult } from "../types";
import type { FetchResult } from "../../fetch/types";
import { htmlToMarkdown } from "../../_internal/html-to-markdown";
import { fetchValidated } from "../../_internal/fetch-validated";

interface QueueEntry {
  url: string;
  depth: number;
}

export const builtinCrawlAdapter: CrawlProviderAdapter = {
  name: "builtin",
  async crawl(rootUrl, options): Promise<CrawlResult> {
    const root = new URL(rootUrl);
    const visited = new Set<string>();
    const queue: QueueEntry[] = [{ url: rootUrl, depth: 0 }];
    const pages: FetchResult[] = [];

    while (queue.length > 0 && pages.length < options.maxPages) {
      options.signal?.throwIfAborted();
      const entry = queue.shift()!;
      const normalized = normalizeUrl(entry.url);

      if (visited.has(normalized)) continue;
      visited.add(normalized);

      if (
        !matchesPatterns(
          entry.url,
          options.includePatterns,
          options.excludePatterns
        )
      ) {
        continue;
      }

      try {
        // Rate limit: 1 second between requests
        if (pages.length > 0) {
          await delay(1000, options.signal);
        }

        // Validates the queued URL and every redirect hop. Links come from the
        // crawled markup, so without this a public page can walk the crawler
        // into loopback or a metadata service. A blocked URL throws and is
        // skipped by the surrounding catch, like any other unreachable page.
        const { response, readBody } = await fetchValidated(entry.url, {
          signal: options.signal,
        });

        // Judge the page by its headers before reading a body it will not use.
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.includes("text/html")) {
          await response.body?.cancel();
          continue;
        }

        const html = await readBody();

        const parsed = htmlToMarkdown(html, entry.url);

        pages.push({
          url: entry.url,
          title: parsed.title,
          markdown: parsed.markdown,
          metadata: {
            statusCode: response.status,
            contentType,
            wordCount: parsed.wordCount,
          },
          source: "builtin" as const,
        });

        // Extract and enqueue links if within depth limit
        if (entry.depth < options.maxDepth) {
          const links = extractLinks(html, entry.url, root.origin);
          for (const link of links) {
            if (!visited.has(normalizeUrl(link))) {
              queue.push({ url: link, depth: entry.depth + 1 });
            }
          }
        }
      } catch {
        // Skip failed pages, continue crawling — unless the run was cancelled,
        // which ends the crawl rather than counting as one failed page.
        options.signal?.throwIfAborted();
        continue;
      }
    }

    return {
      rootUrl,
      pages,
      totalPages: pages.length,
      crawlDepth: options.maxDepth,
      source: "builtin" as const,
    };
  },
};

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  if (parsed.pathname.endsWith("/") && parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

export function extractLinks(
  html: string,
  baseUrl: string,
  origin: string
): string[] {
  const hrefRegex = /<a\s[^>]*href=["']([^"']+)["']/gi;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], baseUrl);
      if (
        resolved.origin === origin &&
        resolved.protocol.startsWith("http")
      ) {
        resolved.hash = "";
        links.push(resolved.toString());
      }
    } catch {
      // Skip invalid URLs
    }
  }
  return links;
}

export function matchesPatterns(
  url: string,
  includes: string[],
  excludes: string[]
): boolean {
  const path = new URL(url).pathname;
  if (excludes.length > 0 && excludes.some((p) => globMatch(path, p))) {
    return false;
  }
  if (includes.length > 0 && !includes.some((p) => globMatch(path, p))) {
    return false;
  }
  return true;
}

export function globMatch(path: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${regex}$`).test(path);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
