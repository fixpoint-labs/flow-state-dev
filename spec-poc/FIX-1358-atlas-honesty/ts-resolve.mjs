/**
 * Minimal resolver hook so plain Node can run the shipped `.ts` readers with no
 * workspace install: it adds the extension TypeScript lets source files omit,
 * and points the one workspace import those readers make at its real,
 * dependency-free source. Nothing here stubs behaviour — the traversal under
 * test runs the shipped code.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FRONTMATTER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../packages/orchestration/src/shared/frontmatter.ts",
);

export async function resolve(specifier, context, next) {
  if (specifier === "@flow-state-dev/orchestration") {
    return { url: pathToFileURL(FRONTMATTER).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && !path.extname(specifier) && context.parentURL) {
    const candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`);
    if (existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
