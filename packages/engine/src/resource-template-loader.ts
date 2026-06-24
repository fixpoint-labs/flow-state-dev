/**
 * Node-only loader for `.md` resource templates.
 *
 * Reads a resource template file relative to the calling module and
 * auto-discovers sibling `.md` files as partials, then forwards to the
 * isomorphic {@link parseResourceTemplate}. Browser consumers pass raw text
 * and an explicit `partials` map to `parseResourceTemplate` instead.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseResourceTemplate,
  type ResourceTemplate,
  type ResourceTemplatePartials,
} from "@flow-state-dev/core/resource-template";

export class ResourceTemplateLoadError extends Error {
  readonly sourcePath?: string;
  constructor(message: string, options?: { cause?: unknown; sourcePath?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ResourceTemplateLoadError";
    this.sourcePath = options?.sourcePath;
  }
}

function readSiblingPartials(dir: string, selfPath: string): ResourceTemplatePartials {
  const partials: ResourceTemplatePartials = {};
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
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
 * Load and parse a `.md` resource template relative to the calling module.
 *
 * @param specifier   Module-relative path, or an absolute path to the template file.
 * @param importerUrl The caller's `import.meta.url` (ignored for absolute specifiers).
 * @param options     Optional partials map override.
 *
 * @throws {ResourceTemplateLoadError} when the file cannot be read.
 * @throws {ResourceTemplateParseError} (via `parseResourceTemplate`) on invalid content.
 */
export function loadResourceTemplate(
  specifier: string,
  importerUrl: string,
  options?: { partials?: ResourceTemplatePartials }
): ResourceTemplate {
  const filePath = path.isAbsolute(specifier)
    ? specifier
    : fileURLToPath(new URL(specifier, importerUrl));

  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new ResourceTemplateLoadError(
      `Failed to read resource template "${specifier}": ${(cause as Error).message}`,
      { cause, sourcePath: filePath }
    );
  }

  const templateDir = path.dirname(filePath);
  const partials = {
    ...readSiblingPartials(templateDir, filePath),
    ...options?.partials,
  };

  return parseResourceTemplate(text, {
    sourcePath: filePath,
    partials,
  });
}

/**
 * Build a resource template loader anchored at `baseDir`.
 *
 * @throws {TypeError} when `baseDir` is not absolute.
 */
export function createResourceTemplateLoader(
  baseDir: string,
  options?: { partialsDir?: string }
): (relPath: string) => ResourceTemplate {
  if (!path.isAbsolute(baseDir)) {
    throw new TypeError(
      `createResourceTemplateLoader: baseDir must be an absolute path, got "${baseDir}".`
    );
  }
  const importerUrl = pathToFileURL(baseDir).href;
  return (relPath) => {
    const partials: ResourceTemplatePartials = {};
    if (options?.partialsDir) {
      const entries = readSiblingPartials(options.partialsDir, "");
      Object.assign(partials, entries);
    }
    return loadResourceTemplate(path.join(baseDir, relPath), importerUrl, { partials });
  };
}
