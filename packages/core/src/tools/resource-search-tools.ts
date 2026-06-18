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
// `ResourceRef`s). Glob is a path-discovery tool (ungated, like `listResources`);
// grep and search read content, so they gate on `llmReadable` for parity with
// `readResourceContentTool`, and they search the raw, un-rendered body
// (`readContentRaw()`) — deterministic and cheaper than rendering every resource.
// Lexical only — no embeddings (semantic recall is the memory / RAG surface's job).
// ---------------------------------------------------------------------------

import { z } from "zod";
import picomatch from "picomatch";
import type { BlockContext } from "../types/block";
import type { ResourceRef } from "../types/resource";
import type { ResourceCollectionRef } from "../types/resource-collection";
import { handler } from "../blocks/handler";

/** Maximum snippet length returned per match, so results stay token-cheap. */
const MAX_SNIPPET_LENGTH = 200;

/**
 * Flatten the resource registry into a single list of `ResourceRef`s — static
 * resources plus every instance of every collection. Collection instances are
 * themselves `ResourceRef`s, so callers treat the two uniformly.
 */
async function collectAllResources(ctx: BlockContext): Promise<ResourceRef<any>[]> {
  const registry = ctx.resources;
  if (registry === undefined) return [];

  const out: ResourceRef<any>[] = [];
  for (const entry of registry.list()) {
    // ResourceCollectionRef has a `pattern` + `create`; a ResourceRef does not.
    if ("pattern" in entry && "create" in entry) {
      const collection = entry as unknown as ResourceCollectionRef<any>;
      const instances = await collection.list();
      for (const instance of instances) out.push(instance);
    } else {
      out.push(entry as ResourceRef<any>);
    }
  }
  return out;
}

/** Content exposure gate — mirrors `readResourceContentTool`'s `llmReadable` contract. */
function isLlmReadable(ref: ResourceRef<any>): boolean {
  return ref.config?.llmReadable === true;
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
 * - `globResources({ pattern?, limit? })` — match resource paths against a glob
 *   (`concepts/**`, `**\/react*`); a null pattern lists every path. Path discovery
 *   only — no content is read, no `llmReadable` gate. Subsumes prefix-listing.
 * - `grepResourceContent({ pattern, prefix?, maxResults? })` — regex / substring
 *   search over `llmReadable` content bodies, returning matching lines.
 * - `searchResources({ query, prefix?, limit? })` — term-frequency ranked search
 *   over `llmReadable` content bodies (lexical, not semantic).
 */
export function resourceSearchTools() {
  const globResources = handler({
    name: "globResources",
    description:
      "Find resources whose path matches a glob pattern (e.g. 'concepts/**', '**/react*'). With no pattern, returns all resource paths.",
    inputSchema: z.object({
      pattern: z
        .string()
        .nullable()
        .default(null)
        .describe("Glob pattern matched against resource paths. Null returns all paths."),
      limit: z.number().int().positive().default(100).describe("Maximum number of paths to return"),
    }),
    outputSchema: z.object({
      paths: z.array(z.string()),
    }),
    execute: async (input, ctx) => {
      const paths = (await collectAllResources(ctx)).map((ref) => ref.path);
      let matched: string[];
      if (input.pattern === null) {
        matched = paths;
      } else {
        const isMatch = picomatch(input.pattern, { dot: true });
        matched = paths.filter((path) => isMatch(path));
      }
      matched.sort();
      return { paths: matched.slice(0, input.limit) };
    },
  });

  const grepResourceContent = handler({
    name: "grepResourceContent",
    description:
      "Search resource content bodies for a regex or literal substring. Returns matching lines with their resource path.",
    inputSchema: z.object({
      pattern: z.string().describe("Regex or literal substring to match within content bodies"),
      prefix: z
        .string()
        .nullable()
        .default(null)
        .describe("Restrict to resources whose path starts with this prefix"),
      maxResults: z.number().int().positive().default(50).describe("Maximum number of matches to return"),
    }),
    outputSchema: z.object({
      matches: z.array(
        z.object({
          path: z.string(),
          line: z.number(),
          snippet: z.string(),
        }),
      ),
    }),
    execute: async (input, ctx) => {
      const matcher = compileMatcher(input.pattern);
      const matches: Array<{ path: string; line: number; snippet: string }> = [];
      const resources = (await collectAllResources(ctx)).filter(isLlmReadable);

      for (const ref of resources) {
        if (input.prefix !== null && !ref.path.startsWith(input.prefix)) continue;
        const content = await ref.readContentRaw();
        if (content === null || content === "") continue;

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          if (matcher.test(lines[i]!)) {
            matches.push({ path: ref.path, line: i + 1, snippet: truncate(lines[i]!.trim()) });
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
      "Rank resources by lexical relevance to a keyword query (term-frequency over content bodies). Returns the top matches. Lexical, not semantic.",
    inputSchema: z.object({
      query: z.string().describe("Keywords to search for"),
      prefix: z
        .string()
        .nullable()
        .default(null)
        .describe("Restrict to resources whose path starts with this prefix"),
      limit: z.number().int().positive().default(10).describe("Maximum number of results to return"),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          path: z.string(),
          score: z.number(),
          snippet: z.string(),
        }),
      ),
    }),
    execute: async (input, ctx) => {
      const terms = input.query
        .toLowerCase()
        .split(/\W+/)
        .filter((term) => term.length > 0);
      if (terms.length === 0) return { results: [] };

      const resources = (await collectAllResources(ctx)).filter(isLlmReadable);
      const scored: Array<{ path: string; score: number; snippet: string }> = [];

      for (const ref of resources) {
        if (input.prefix !== null && !ref.path.startsWith(input.prefix)) continue;
        const content = await ref.readContentRaw();
        if (content === null || content === "") continue;

        const lower = content.toLowerCase();
        let score = 0;
        for (const term of terms) score += countOccurrences(lower, term);
        if (score === 0) continue;

        scored.push({ path: ref.path, score, snippet: firstMatchingLine(content, terms) });
      }

      scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
      return { results: scored.slice(0, input.limit) };
    },
  });

  return { globResources, grepResourceContent, searchResources };
}
