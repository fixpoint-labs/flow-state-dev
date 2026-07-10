// ---------------------------------------------------------------------------
// Resource navigation tools for the LLM tool surface.
//
// The agent-facing Glob/Grep/Search trio over resources — the three "find"
// modes that key-addressed read/write and prefix-listing don't cover:
//   - globResources       — deterministic path matching (true glob via picomatch)
//   - grepResourceContent — deterministic content matching (regex / substring)
//   - searchResources     — fuzzy ranked matching (term-frequency lexical scoring)
//
// All three enumerate both static resources and collection instances (both are
// `ResourceRef`s). Glob is a discovery tool (ungated, like `listResources`);
// grep and search read content, so they gate on `llmReadable` for parity with
// `readResourceContentTool` and search the *rendered* content (`readContent()`,
// the same bytes that tool returns) — so they find what the agent can actually
// read, including resources whose body is a state-rendered template. All three
// emit the scope-qualified `uri` (`${scope}/${path}`) — the unique handle the
// content tools resolve (FIX-842), so the agent can feed a glob/grep result
// straight to read/write. Glob patterns and the grep/search `prefix` match the
// within-scope `path` (so callers write scope-free patterns like `concepts/**`),
// while results are emitted as uris; these tools enumerate the collections they
// search, so they suit bounded, curated content. Lexical only — no embeddings
// (semantic recall is the memory / RAG job).
// ---------------------------------------------------------------------------

import { z } from "zod";
import picomatch from "picomatch";
import { handler } from "../blocks/handler";
import { collectAllResources, collectExternalCollections, collectReadableResources } from "./resource-tools";
import type { ExternalResourceCollectionRef } from "../types/external-resource-collection";

/** Maximum snippet length returned per match, so results stay token-cheap. */
const MAX_SNIPPET_LENGTH = 200;

/**
 * Path-boundary prefix test. Matches the path itself or anything beneath it as a
 * path segment (`concepts`, `concepts/react`), never a sibling that merely shares
 * leading characters (`conceptsX`). This is what callers mean by "under this path",
 * and unlike a bare `startsWith` it won't leak `concepts/*` into a `concept` scope.
 */
function matchesPrefix(path: string, prefix: string): boolean {
  if (prefix === "") return true;
  if (path === prefix) return true;
  const boundary = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return path.startsWith(boundary);
}

/** Truncate a snippet to `MAX_SNIPPET_LENGTH`, appending an ellipsis when cut. */
function truncate(text: string): string {
  return text.length > MAX_SNIPPET_LENGTH ? `${text.slice(0, MAX_SNIPPET_LENGTH)}…` : text;
}

/**
 * Compile a grep pattern into a matcher. The pattern is treated as a regular
 * expression; if it is not valid regex syntax it falls back to matching as a
 * literal substring (so `a(` searches for the text `a(` rather than throwing).
 *
 * Matching runs line by line (see `grepResourceContent`), so each `test()` only
 * scans one line — this bounds the common case but does NOT sandbox an adversarial
 * catastrophic-backtracking pattern. There is no cheap synchronous regex timeout
 * in JS; these tools are lexical search over trusted, curated content. Isolate the
 * call (RE2 or a worker timeout) before pointing them at attacker-controlled
 * patterns or bodies.
 */
function compileMatcher(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
}

/** Count non-overlapping occurrences of `needle` in `haystack` (both lowercased by the caller). */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** First content line containing any query term, else the head of the content. */
function firstMatchingLine(content: string, terms: string[]): string {
  for (const line of content.split("\n")) {
    const lower = line.toLowerCase();
    if (terms.some((term) => lower.includes(term))) return truncate(line.trim());
  }
  return truncate(content.trim());
}

/**
 * Resource navigation tool blocks for the LLM tool surface — the Glob/Grep/Search
 * trio over resources. Returns handler blocks that work across all registered
 * static resources and collections:
 *
 * - `globResources({ pattern?, limit? })` — match the within-scope path against a
 *   glob (`concepts/**`, `**\/react*`); a null pattern lists everything. Discovery
 *   only — no content is read, no `llmReadable` gate. Subsumes prefix-listing.
 * - `grepResourceContent({ pattern, prefix?, maxResults? })` — regex / substring
 *   search over `llmReadable` content bodies, returning matching lines.
 * - `searchResources({ query, prefix?, limit? })` — term-frequency ranked search
 *   over `llmReadable` content bodies (lexical, not semantic).
 *
 * All three return the scope-qualified `uri` of each match — the unique handle
 * the content tools accept.
 */
export function resourceSearchTools() {
  const globResources = handler({
    name: "globResources",
    description:
      "Find resources whose path matches a glob pattern (e.g. 'concepts/**', '**/react*'). With no pattern, returns every resource. Returns scope-qualified uris.",
    inputSchema: z.object({
      pattern: z
        .string()
        .nullable()
        .default(null)
        .describe("Glob pattern matched against the within-scope resource path. Null returns everything."),
      limit: z.number().int().positive().default(100).describe("Maximum number of uris to return"),
    }),
    outputSchema: z.object({
      uris: z.array(z.string()),
    }),
    execute: async (input, ctx) => {
      const refs = await collectAllResources(ctx);
      const isMatch = input.pattern === null ? null : picomatch(input.pattern, { dot: true });
      const matched = refs.filter((ref) => isMatch === null || isMatch(ref.path)).map((ref) => ref.uri);
      matched.sort();
      return { uris: matched.slice(0, input.limit) };
    },
  });

  const grepResourceContent = handler({
    name: "grepResourceContent",
    description:
      "Search resource content bodies for a regex or literal substring. Returns matching lines with the resource's scope-qualified uri.",
    inputSchema: z.object({
      pattern: z.string().describe("Regex or literal substring to match within content bodies"),
      prefix: z
        .string()
        .nullable()
        .default(null)
        .describe("Restrict to resources at or under this within-scope path prefix (matched on a path boundary, not a bare string prefix)"),
      maxResults: z.number().int().positive().default(50).describe("Maximum number of matches to return"),
    }),
    outputSchema: z.object({
      matches: z.array(
        z.object({
          uri: z.string(),
          line: z.number(),
          snippet: z.string(),
        }),
      ),
    }),
    execute: async (input, ctx) => {
      const matcher = compileMatcher(input.pattern);
      const matches: Array<{ uri: string; line: number; snippet: string }> = [];
      const resources = await collectReadableResources(ctx);

      for (const ref of resources) {
        if (input.prefix !== null && !matchesPrefix(ref.path, input.prefix)) continue;
        const content = await ref.readContent();
        if (content === null || content === "") continue;

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          if (matcher.test(lines[i]!)) {
            matches.push({ uri: ref.uri, line: i + 1, snippet: truncate(lines[i]!.trim()) });
            if (matches.length >= input.maxResults) return { matches };
          }
        }
      }
      return { matches };
    },
  });

  const searchResources = handler({
    name: "searchResources",
    description:
      "Rank resources by lexical relevance to a keyword query (term-frequency over content bodies). Returns the top matches by scope-qualified uri. Lexical, not semantic.",
    inputSchema: z.object({
      query: z.string().describe("Keywords to search for"),
      prefix: z
        .string()
        .nullable()
        .default(null)
        .describe("Restrict to resources at or under this within-scope path prefix (matched on a path boundary, not a bare string prefix)"),
      limit: z.number().int().positive().default(10).describe("Maximum number of results to return"),
      cursor: z
        .string()
        .nullable()
        .default(null)
        .describe("Opaque pagination cursor from a prior page's nextCursor (external collections only). Null starts from the first page."),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          uri: z.string(),
          score: z.number(),
          snippet: z.string(),
        }),
      ),
      nextCursor: z.string().optional().describe("Present when more external-collection results remain; pass it back as `cursor`."),
    }),
    execute: async (input, ctx) => {
      const terms = input.query
        .toLowerCase()
        .split(/\W+/)
        .filter((term) => term.length > 0);
      if (terms.length === 0) return { results: [] };

      // External collections (FIX-858): push the query DOWN to each readable
      // external collection's `search` (the app engine ranks/filters — no
      // in-memory scan). Hits arrive in app (hook) order; the framework derives
      // a rank-preserving score and a snippet from rendered content.
      const externalResults: Array<{ uri: string; score: number; snippet: string }> = [];
      let nextCursor: string | undefined;
      const externalCollections = collectExternalCollections(ctx).filter(
        (ns) => ns.ref.config?.llmReadable === true
      );
      for (const ns of externalCollections) {
        const extRef = ns.ref as unknown as ExternalResourceCollectionRef;
        const page = await extRef.list({
          search: input.query,
          ...(input.prefix !== null ? { prefix: input.prefix } : {}),
          limit: input.limit,
          ...(input.cursor !== null ? { cursor: input.cursor } : {}),
        });
        // Rank-preserving score (app/hook order → descending); snippet rendered
        // from the record's content template.
        for (let i = 0; i < page.items.length; i += 1) {
          const ref = page.items[i]!;
          const content = await ref.readContent();
          externalResults.push({
            uri: ref.uri,
            score: page.items.length - i,
            snippet: content ? firstMatchingLine(content, terms) : "",
          });
        }
        if (page.nextCursor !== undefined) nextCursor = page.nextCursor;
      }

      // A cursor continuation advances only the external pagination — the
      // bounded store-backed set was fully returned on the first page.
      if (input.cursor !== null) {
        return nextCursor === undefined
          ? { results: externalResults }
          : { results: externalResults, nextCursor };
      }

      const resources = await collectReadableResources(ctx);
      const scored: Array<{ uri: string; score: number; snippet: string }> = [];

      for (const ref of resources) {
        if (input.prefix !== null && !matchesPrefix(ref.path, input.prefix)) continue;
        const content = await ref.readContent();
        if (content === null || content === "") continue;

        const lower = content.toLowerCase();
        let score = 0;
        for (const term of terms) score += countOccurrences(lower, term);
        if (score === 0) continue;

        scored.push({ uri: ref.uri, score, snippet: firstMatchingLine(content, terms) });
      }

      scored.sort((a, b) => b.score - a.score || a.uri.localeCompare(b.uri));
      const results = [...externalResults, ...scored.slice(0, input.limit)];
      return nextCursor === undefined ? { results } : { results, nextCursor };
    },
  });

  return { globResources, grepResourceContent, searchResources };
}
