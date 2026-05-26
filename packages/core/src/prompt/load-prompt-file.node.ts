/**
 * Node-only loader for `.md` prompt files.
 *
 * Reads a prompt file relative to the calling module (`import.meta.url`) and
 * auto-discovers sibling `.md` files in the same directory as partials, then
 * forwards to the isomorphic {@link parsePromptFile}. This is the only file in
 * the package that imports `node:fs`, keeping the browser-safe parser free of
 * filesystem dependencies. Browser/bundled consumers must not import this
 * module — they pass raw text and an explicit `partials` map to
 * `parsePromptFile` instead.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parsePromptFile,
  PromptFileLoadError,
  type PromptFile,
  type PromptFileFilters,
  type PromptFilePartials,
} from "./prompt-file.js";

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
 * and used as-is — useful where bundling makes `import.meta.url` unreliable
 * (e.g. Next.js), so callers can anchor at `process.cwd()` instead.
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
 * const load = createPromptLoader(path.resolve(process.cwd(), "src/prompts"), {
 *   partialsDir: path.resolve(process.cwd(), "src/prompts/_partials"),
 * });
 * const analyst = load("analyst.prompt.md");
 * ```
 *
 * `baseDir` must be an absolute directory path. `relPath` is joined onto it,
 * yielding an absolute path — so the resolution never depends on
 * `import.meta.url`, which bundlers (e.g. Next.js) make unreliable. Anchor at
 * `process.cwd()` or a path derived from `fileURLToPath(import.meta.url)`.
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
        `Anchor at process.cwd() or fileURLToPath(import.meta.url).`
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
