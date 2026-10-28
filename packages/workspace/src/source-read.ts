/**
 * The host's read view: what a read of a run source's files asks for, what it
 * answers, and the caps every answer is held to.
 *
 * A **read** looks at the files a run source answers with, without a run: no
 * branch is cut, no worktree or place is made, and nothing is written. A
 * repository is read at one commit of its remote's default branch; kept files
 * are read from their collection. The git half lives in `./local-host`, beside
 * the clone it reads; this module holds the vocabulary, the caps, and the
 * parts that need no git: checking a path, cutting a body, matching a glob,
 * and reading kept files.
 *
 * **The caps live here and nowhere else.** Every read passes through one of
 * the functions below on its way out, so a tool built on the view adds no cap
 * of its own, and a result is always bounded (a tool result is recorded).
 */
import picomatch from "picomatch";
import { getPatternPrefix } from "@flow-state-dev/core/types";
import { WorkspaceRefusedError } from "./refused";
import type { RunFiles } from "./run-source";

/** The caps every read is held to. Each result says when it was cut, and by how much. */
export const SOURCE_READ_LIMITS = {
  /** Paths one glob returns. */
  paths: 500,
  /** Lines one read returns. */
  lines: 2_000,
  /** Bytes one read returns, counted in UTF-8. */
  bytes: 256 * 1024,
  /** Matches one grep returns. */
  matches: 200,
  /** Characters of one grep match's line. */
  snippet: 200,
} as const;

/**
 * How long a fetch of a shared clone serves reads before the next read fetches
 * again. A model reads in bursts, so a minute bounds staleness without a fetch
 * per call.
 */
export const SOURCE_READ_FRESH_MS = 60_000;

/** What one read asks for. Every path is a repository path: `/`-separated, no leading `/`, no `.` or `..` segment. */
export type SourceReadRequest =
  | {
      kind: "glob";
      /** A glob matched against each path (`src/**`, `**\/*.ts`). Omitted or `null`: every path. */
      pattern?: string | null;
      /** At most this many paths, and never more than the cap. */
      limit?: number | null;
    }
  | {
      kind: "read";
      /** The file to read. */
      path: string;
      /** The first line to return, counting from 1. Omitted: 1. */
      startLine?: number | null;
      /** The last line to return. Omitted: the end of the file, within the caps. */
      endLine?: number | null;
    }
  | {
      kind: "grep";
      /** A regular expression, or a literal when it doesn't compile. The result names which. */
      pattern: string;
      /** Only files at or under this path. */
      prefix?: string | null;
      /** At most this many matches, and never more than the cap. */
      maxResults?: number | null;
    };

/** Which version of the files a read saw. */
export type SourceReadAt =
  | {
      kind: "repo";
      /** The commit every part of this read came from. */
      commit: string;
      /** The branch it was resolved from: the remote's default branch, or a mapped checkout's base. */
      branch: string;
      /** When the shared clone was last fetched, as an ISO time; `null` for a checkout on this machine. */
      fetchedAt: string | null;
      /** How long ago that was, in milliseconds; `null` when `fetchedAt` is. */
      ageMs: number | null;
    }
  | { kind: "files" };

/** A result the caps cut short: how many more there were. */
export interface SourceReadCut {
  /** What was left out, in the result's own unit: paths, lines or matches. */
  left: number;
  /** Which cap cut it. */
  by: "paths" | "lines" | "bytes" | "matches" | "limit";
}

/** The regular expression dialect a grep used. */
export type GrepDialect = "extended-regex" | "javascript-regex" | "literal";

/** What one read answers. */
export type SourceReadResult =
  | { kind: "glob"; at: SourceReadAt; paths: string[]; cut: SourceReadCut | null }
  | {
      kind: "read";
      at: SourceReadAt;
      path: string;
      status: "ok";
      /** The lines returned, `startLine` to `endLine`, joined with `\n`. */
      content: string;
      startLine: number;
      endLine: number;
      /** The lines in the whole file. */
      totalLines: number;
      cut: SourceReadCut | null;
    }
  | {
      kind: "read";
      at: SourceReadAt;
      path: string;
      /** `missing`: no file there. `directory`: a directory, not a file. `binary`: refused, not text. `too-large`: past what a read loads. */
      status: "missing" | "directory" | "binary" | "too-large";
      /** The file's size, for `binary` and `too-large`. */
      bytes?: number;
    }
  | {
      kind: "grep";
      at: SourceReadAt;
      dialect: GrepDialect;
      matches: { path: string; line: number; snippet: string }[];
      /** Binary files are never searched. */
      binary: "skipped";
      cut: SourceReadCut | null;
    };

/** Refuse a path that is not a plain repository path. */
export function checkSourcePath(path: string, what = "path"): string {
  const segments = path.split("/");
  const bad =
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..");
  if (bad) {
    throw new WorkspaceRefusedError(
      "invalid-path",
      `the ${what} ${JSON.stringify(path)} is not a repository path: use "/" between names, with no leading "/" ` +
        `and no empty, "." or ".." part, e.g. "src/index.ts".`,
    );
  }
  return path;
}

/** The paths a glob keeps, sorted and cut to the limit and the cap. */
export function globPaths(all: readonly string[], pattern: string | null | undefined, limit: number | null | undefined): {
  paths: string[];
  cut: SourceReadCut | null;
} {
  const isMatch = pattern == null || pattern === "" ? null : picomatch(pattern, { dot: true });
  const matched = all.filter((path) => isMatch === null || isMatch(path)).sort();
  return capped(matched, limit, SOURCE_READ_LIMITS.paths, "paths");
}

/** `items` cut to the smaller of `limit` and `cap`, saying which cut it. */
function capped<T>(items: T[], limit: number | null | undefined, cap: number, by: SourceReadCut["by"]): { paths: T[]; cut: SourceReadCut | null } {
  const max = capOf(limit, cap);
  return { paths: items.slice(0, max), cut: cutOf(items.length, limit, cap, by) };
}

/** The most a result returns: the smaller of `limit` and the cap. */
function capOf(limit: number | null | undefined, cap: number): number {
  return limit == null ? cap : Math.min(Math.max(1, Math.floor(limit)), cap);
}

/** The cut of `total` items to the smaller of `limit` and the cap, or `null` when none was cut. */
function cutOf(total: number, limit: number | null | undefined, cap: number, by: SourceReadCut["by"]): SourceReadCut | null {
  const max = capOf(limit, cap);
  return total <= max ? null : { left: total - max, by: limit != null && limit < cap ? "limit" : by };
}

/** Whether `text` reads as binary: a NUL byte in its first 8,000 characters, git's own test. */
export function looksBinary(text: string): boolean {
  return text.slice(0, 8_000).includes("\0");
}

/** The body of a text file, cut to the asked line range and the caps. */
export function readBody(
  path: string,
  text: string,
  request: { startLine?: number | null; endLine?: number | null },
  at: SourceReadAt,
): SourceReadResult {
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  const totalLines = text === "" ? 0 : lines.length;
  const start = Math.max(1, Math.floor(request.startLine ?? 1));
  const end = Math.min(totalLines, Math.floor(request.endLine ?? totalLines));
  const wanted = start > end ? [] : lines.slice(start - 1, end);
  const max = Math.min(wanted.length, SOURCE_READ_LIMITS.lines);
  let taken = 0;
  let bytes = 0;
  while (taken < max) {
    const size = Buffer.byteLength(wanted[taken]!) + 1;
    if (bytes + size > SOURCE_READ_LIMITS.bytes) break;
    bytes += size;
    taken += 1;
  }
  let content = wanted.slice(0, taken).join("\n");
  let cut: SourceReadCut | null = null;
  if (taken < wanted.length) {
    const byBytes = taken < max;
    // One line longer than the whole byte cap: its head, rather than nothing.
    if (taken === 0) {
      content = Buffer.from(wanted[0]!).subarray(0, SOURCE_READ_LIMITS.bytes).toString("utf8");
      taken = 1;
    }
    cut = { left: wanted.length - taken, by: byBytes ? "bytes" : "lines" };
  }
  return { kind: "read", at, path, status: "ok", content, startLine: start, endLine: start + taken - 1, totalLines, cut };
}

/** A grep line's snippet: trimmed, and cut to the cap. */
export function snippetOf(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > SOURCE_READ_LIMITS.snippet ? `${trimmed.slice(0, SOURCE_READ_LIMITS.snippet)}…` : trimmed;
}

/** Matches cut to the smaller of `maxResults` and the cap. */
export function cutMatches<T>(matches: T[], maxResults: number | null | undefined): { matches: T[]; cut: SourceReadCut | null } {
  const { paths, cut } = capped(matches, maxResults, SOURCE_READ_LIMITS.matches, "matches");
  return { matches: paths, cut };
}

/** The most matches a grep keeps: the smaller of `maxResults` and the cap. */
export function matchCap(maxResults: number | null | undefined): number {
  return capOf(maxResults, SOURCE_READ_LIMITS.matches);
}

/** The cut of `total` matches to `matchCap(maxResults)`, for a grep that counted the rest rather than keeping them. */
export function matchesCut(total: number, maxResults: number | null | undefined): SourceReadCut | null {
  return cutOf(total, maxResults, SOURCE_READ_LIMITS.matches, "matches");
}

/** Whether `path` is `prefix` or under it, on a path boundary. */
export function underPrefix(path: string, prefix: string | null | undefined): boolean {
  if (prefix == null || prefix === "") return true;
  return path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

/**
 * Compile a grep pattern as JavaScript's regular expression, or as a literal
 * when it doesn't compile, saying which. Lines are matched one at a time.
 */
export function compileGrep(pattern: string): { matcher: RegExp; dialect: GrepDialect } {
  try {
    return { matcher: new RegExp(pattern), dialect: "javascript-regex" };
  } catch {
    return { matcher: new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), dialect: "literal" };
  }
}

/**
 * Read kept files: the rows of `files.collection` under `<projectId>/`, and
 * nothing else. The collection is asked for that prefix alone, filtered where
 * the rows are read (BP-033), and each key is checked again on the way out.
 */
export async function readKeptFiles(projectId: string, files: RunFiles, request: SourceReadRequest): Promise<SourceReadResult> {
  const at: SourceReadAt = { kind: "files" };
  const within = `${projectId}/`;
  const patternPrefix = getPatternPrefix(files.collection.pattern);
  const strip = (path: string) => (patternPrefix !== "" && path.startsWith(`${patternPrefix}/`) ? path.slice(patternPrefix.length + 1) : path);
  const rows = async () => {
    const out: { path: string; read: () => Promise<string | null> }[] = [];
    for (const entry of await files.collection.list(within)) {
      const key = strip(entry.path);
      if (!key.startsWith(within)) continue;
      out.push({ path: key.slice(within.length), read: () => entry.readContent() });
    }
    return out;
  };

  if (request.kind === "glob") {
    return { kind: "glob", at, ...globPaths((await rows()).map((row) => row.path), request.pattern, request.limit) };
  }
  if (request.kind === "read") {
    const path = checkSourcePath(request.path);
    const listed = await rows();
    const row = listed.find((candidate) => candidate.path === path);
    const text = row === undefined ? null : await row.read();
    if (text === null) {
      const isDirectory = listed.some((candidate) => candidate.path.startsWith(`${path}/`));
      return { kind: "read", at, path, status: isDirectory ? "directory" : "missing" };
    }
    if (looksBinary(text)) return { kind: "read", at, path, status: "binary", bytes: Buffer.byteLength(text) };
    return readBody(path, text, request, at);
  }
  const prefix = request.prefix == null || request.prefix === "" ? null : checkSourcePath(request.prefix, "prefix");
  const { matcher, dialect } = compileGrep(request.pattern);
  const found: { path: string; line: number; snippet: string }[] = [];
  for (const row of (await rows()).sort((a, b) => a.path.localeCompare(b.path))) {
    if (!underPrefix(row.path, prefix)) continue;
    const text = await row.read();
    if (text === null || looksBinary(text)) continue;
    text.split("\n").forEach((line, index) => {
      if (matcher.test(line)) found.push({ path: row.path, line: index + 1, snippet: snippetOf(line) });
    });
  }
  return { kind: "grep", at, dialect, binary: "skipped", ...cutMatches(found, request.maxResults) };
}
