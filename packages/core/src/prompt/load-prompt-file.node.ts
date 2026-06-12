/**
 * Node-only loader for `.md` prompt files.
 *
 * Reads a prompt file relative to the calling module (`import.meta.url`) and
 * auto-discovers sibling `.md` files in the same directory as partials, then
 * forwards to the isomorphic {@link parsePromptFile}. Also hosts the base-dir
 * resolution helpers ({@link moduleDir}, {@link resolveBaseDir}) that callers
 * use to compute a cwd-independent anchor for {@link createPromptLoader}.
 * This is the only file in the package that imports `node:fs`, keeping the
 * browser-safe parser free of filesystem dependencies. Browser/bundled
 * consumers must not import this module — they pass raw text and an explicit
 * `partials` map to `parsePromptFile` instead.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parsePromptFile,
  PromptFileLoadError,
  type PromptFile,
  type PromptFileFilters,
  type PromptFilePartials,
} from "./prompt-file";

/**
 * Directory of the module identified by `importerUrl` (normally the caller's
 * `import.meta.url`), optionally walked by `relative`.
 *
 * Returns `undefined` when `importerUrl` is not a usable `file:` URL —
 * bundlers (e.g. Turbopack) rewrite `import.meta.url` to virtual schemes, so
 * callers compose this with {@link resolveBaseDir} and an absolute fallback
 * rather than using the result directly. Node resolves ES modules at their
 * realpath (pnpm-linked packages included), so the returned directory — and
 * any walk relative to it — stays inside the package's real location
 * regardless of how the package was symlinked.
 *
 * @param importerUrl The caller's `import.meta.url`.
 * @param relative    Optional path from the module's directory to the wanted
 *                    directory (e.g. `".."`). Defaults to the module's own dir.
 */
export function moduleDir(importerUrl: string, relative = "."): string | undefined {
  try {
    const url = new URL(importerUrl);
    if (url.protocol !== "file:") return undefined;
    return path.resolve(path.dirname(fileURLToPath(url)), relative);
  } catch {
    return undefined;
  }
}

/** Options for {@link resolveBaseDir}. */
export interface ResolveBaseDirOptions {
  /**
   * Relative path that must exist inside a candidate for it to qualify.
   * Guards against bundler-rewritten module URLs that resolve to an existing
   * directory inside the build output (e.g. `.next/`) — such a directory
   * exists but won't contain the expected content. Defaults to accepting any
   * existing candidate directory.
   */
  expect?: string;
}

/**
 * First candidate directory that exists (and contains `expect`, when given).
 *
 * `undefined` entries are skipped, so {@link moduleDir} results compose
 * directly — the standard anchoring idiom is a module-relative candidate
 * first, then an explicit `process.cwd()`-derived fallback for bundled
 * runtimes that pin the working directory (Next.js dev/build):
 *
 * ```ts
 * const APP_ROOT = resolveBaseDir(
 *   [moduleDir(import.meta.url, "../.."), process.cwd()],
 *   { expect: "src/prompts" },
 * );
 * ```
 *
 * @throws {TypeError} when any defined candidate is not an absolute path —
 *   checked eagerly for every candidate before probing, so a malformed
 *   fallback fails in every runtime, not only in the runtime where the
 *   earlier candidates happen to miss.
 * @throws {Error} when no candidate qualifies; the message lists every
 *   candidate with the reason it was rejected.
 */
export function resolveBaseDir(
  candidates: ReadonlyArray<string | undefined>,
  options?: ResolveBaseDirOptions
): string {
  const expect = options?.expect;
  const defined = candidates.filter((c): c is string => c !== undefined);
  for (const candidate of defined) {
    if (!path.isAbsolute(candidate)) {
      throw new TypeError(
        `resolveBaseDir: candidates must be absolute paths, got "${candidate}". ` +
          `Derive candidates from moduleDir(import.meta.url, ...) or process.cwd().`
      );
    }
  }
  const rejected: string[] = [];
  for (const candidate of defined) {
    if (!existsSync(candidate)) {
      rejected.push(`  - ${candidate} (does not exist)`);
      continue;
    }
    if (!statSync(candidate).isDirectory()) {
      rejected.push(`  - ${candidate} (not a directory)`);
      continue;
    }
    if (expect !== undefined && !existsSync(path.join(candidate, expect))) {
      rejected.push(`  - ${candidate} (missing "${expect}")`);
      continue;
    }
    return candidate;
  }
  const skippedNote =
    defined.length < candidates.length
      ? `\n(Undefined candidates were skipped — typically a bundler-rewritten import.meta.url.)`
      : "";
  throw new Error(
    `resolveBaseDir: no candidate directory qualified.\nTried:\n` +
      (rejected.length > 0 ? rejected.join("\n") : "  (no defined candidates)") +
      skippedNote +
      `\nPass an absolute fallback derived from a directory the runtime pins ` +
      `(e.g. process.cwd() under Next.js dev/build, which pin cwd to the app package).`
  );
}

/** Options for {@link loadPromptFile}. */
export interface LoadPromptFileOptions {
  /** Custom Liquid filters, scoped to this PromptFile. */
  filters?: PromptFileFilters;
  /**
   * Directory to discover partial `.md` files in. Defaults to the directory of
   * the loaded prompt file. Every `.md` file in this directory (excluding the
   * prompt file itself) becomes a partial under its filename without `.md`.
   */
  partialsDir?: string;
}

/** Read every `*.md` file in `dir` (except `selfPath`) into a partials map
 * keyed by filename without the `.md` extension. */
function readSiblingPartials(dir: string, selfPath: string): PromptFilePartials {
  const partials: PromptFilePartials = {};
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Missing/unreadable directory → no partials. A `{% render %}` against a
    // missing partial then fails at parse time with a clear message.
    return partials;
  }
  const selfName = path.basename(selfPath);
  for (const entry of entries) {
    if (!entry.endsWith(".md") || entry === selfName) continue;
    const name = entry.slice(0, -".md".length);
    partials[name] = readFileSync(path.join(dir, entry), "utf8");
  }
  return partials;
}

/**
 * Load and parse a `.md` prompt file relative to the calling module.
 *
 * `specifier` is normally module-relative (`"./analyst.prompt.md"`), resolved
 * against `importerUrl` (`import.meta.url`). An absolute path is also accepted
 * and used as-is (`importerUrl` is then ignored) — useful where bundling makes
 * `import.meta.url` unreliable (e.g. Next.js). Compute that absolute anchor
 * with {@link resolveBaseDir} rather than bare `process.cwd()`, so resolution
 * doesn't depend on the invoker's working directory.
 *
 * @param specifier   Module-relative path, or an absolute path to the prompt file.
 * @param importerUrl The caller's `import.meta.url` (ignored for absolute specifiers).
 * @param options     Custom filters and an optional partials directory override.
 *
 * @throws {@link PromptFileLoadError} when the file cannot be read.
 * @throws {@link PromptFileParseError} (via `parsePromptFile`) on invalid content.
 */
export function loadPromptFile(
  specifier: string,
  importerUrl: string,
  options?: LoadPromptFileOptions
): PromptFile {
  const filePath = path.isAbsolute(specifier)
    ? specifier
    : fileURLToPath(new URL(specifier, importerUrl));

  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new PromptFileLoadError(
      `Failed to read prompt file "${specifier}": ${(cause as Error).message}`,
      { cause, sourcePath: filePath }
    );
  }

  const promptDir = path.dirname(filePath);
  const partials = readSiblingPartials(options?.partialsDir ?? promptDir, filePath);

  return parsePromptFile(text, {
    sourcePath: filePath,
    partials,
    ...(options?.filters !== undefined ? { filters: options.filters } : {}),
  });
}

/** Options for {@link createPromptLoader}. */
export interface PromptLoaderOptions {
  /**
   * Shared partials directory for every prompt this loader reads. Defaults to
   * each prompt's own directory (the {@link loadPromptFile} default). Set this
   * once when many prompts pull from a common `_partials` dir.
   */
  partialsDir?: string;
  /** Liquid filters applied to every prompt this loader reads. */
  filters?: PromptFileFilters;
}

/** A loader returned by {@link createPromptLoader}: resolves `relPath` against
 * the captured base directory and loads the prompt. Per-call `filters` merge
 * over (and override) the loader's shared filters. */
export type PromptLoader = (
  relPath: string,
  perCallOptions?: { filters?: PromptFileFilters }
) => PromptFile;

/**
 * Build a prompt loader anchored at `baseDir`, so call sites drop the
 * repeated `importerUrl` (`import.meta.url`) argument and shared
 * `partialsDir` / `filters`:
 *
 * ```ts
 * const PROMPT_ROOT = resolveBaseDir(
 *   [moduleDir(import.meta.url, "./prompts"), path.resolve(process.cwd(), "src/prompts")],
 *   { expect: "_partials" },
 * );
 * const load = createPromptLoader(PROMPT_ROOT, {
 *   partialsDir: path.join(PROMPT_ROOT, "_partials"),
 * });
 * const analyst = load("analyst.prompt.md");
 * ```
 *
 * Resolution rule: `baseDir` must be an absolute directory path; `relPath` is
 * joined onto it, yielding an absolute path — so resolution never depends on
 * the invoker's working directory or on `import.meta.url` at load-call time.
 * Compute `baseDir` once with {@link resolveBaseDir}: module-relative
 * candidate first (real `import.meta.url` under node/tsx/vitest from any
 * cwd), `process.cwd()`-derived fallback for bundled runtimes (e.g. Next.js,
 * where Turbopack rewrites `import.meta.url` but dev/build pin cwd to the app
 * package).
 *
 * @throws {TypeError} when `baseDir` is not absolute.
 */
export function createPromptLoader(
  baseDir: string,
  options?: PromptLoaderOptions
): PromptLoader {
  if (!path.isAbsolute(baseDir)) {
    throw new TypeError(
      `createPromptLoader: baseDir must be an absolute path, got "${baseDir}". ` +
        `Compute it with resolveBaseDir([moduleDir(import.meta.url, ...), <absolute fallback>]).`
    );
  }
  const importerUrl = pathToFileURL(baseDir).href;
  return (relPath, perCallOptions) => {
    const filters =
      perCallOptions?.filters !== undefined || options?.filters !== undefined
        ? { ...options?.filters, ...perCallOptions?.filters }
        : undefined;
    return loadPromptFile(path.join(baseDir, relPath), importerUrl, {
      ...(options?.partialsDir !== undefined ? { partialsDir: options.partialsDir } : {}),
      ...(filters !== undefined ? { filters } : {}),
    });
  };
}
