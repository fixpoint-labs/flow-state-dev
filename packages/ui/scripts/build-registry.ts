/**
 * Compiles registry.json into individual JSON files in public/r/.
 *
 * Each registry item gets its own JSON file following the shadcn registry-item schema,
 * with source files embedded as `content` strings. An index.json is also generated
 * containing the full registry manifest.
 *
 * A registry dependency that names another item in THIS registry is written as
 * that item's full URL (`<base>/<name>.json`). The shadcn CLI resolves a bare
 * name against its own registry, so `"tokens"` would be looked up on
 * ui.shadcn.com and fail; a URL is what its registry docs ask for. Names the
 * registry doesn't define (`button`, `collapsible`) stay bare and resolve
 * against shadcn's. Style items (`registry:theme`) carry `cssVars` and `css`
 * rather than files, and both are passed through.
 *
 * Options (flags or env):
 *   --base-url <url>  REGISTRY_BASE_URL  where the built files will be served
 *                                        (default https://ui.flow-state.dev/r)
 *   --out <dir>       REGISTRY_OUT_DIR   where to write them (default public/r)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = resolve(ROOT, "registry.json");
const DEFAULT_BASE_URL = "https://ui.flow-state.dev/r";

interface RegistryFile {
  type: string;
  path: string;
  target: string;
}

interface RegistryItem {
  name: string;
  title: string;
  type: string;
  description: string;
  dependencies: string[];
  registryDependencies: string[];
  files?: RegistryFile[];
  cssVars?: Record<string, Record<string, string>>;
  css?: Record<string, unknown>;
  categories: string[];
}

interface Registry {
  $schema: string;
  name: string;
  homepage: string;
  items: RegistryItem[];
}

/** The value of `--<flag> <value>`, else the env var, else the default. */
function option(flag: string, env: string, fallback: string): string {
  const at = process.argv.indexOf(`--${flag}`);
  if (at !== -1 && process.argv[at + 1] !== undefined) return process.argv[at + 1]!;
  return process.env[env] ?? fallback;
}

function main() {
  if (!existsSync(REGISTRY_PATH)) {
    console.error("registry.json not found at", REGISTRY_PATH);
    process.exit(1);
  }

  const baseUrl = option("base-url", "REGISTRY_BASE_URL", DEFAULT_BASE_URL).replace(/\/+$/, "");
  const outputDir = resolve(option("out", "REGISTRY_OUT_DIR", resolve(ROOT, "public", "r")));
  const registry: Registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  const ownNames = new Set(registry.items.map((item) => item.name));
  const qualify = (dep: string) => (ownNames.has(dep) ? `${baseUrl}/${dep}.json` : dep);

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  const indexItems: object[] = [];

  for (const item of registry.items) {
    const outputItem: Record<string, unknown> = {
      name: item.name,
      title: item.title,
      type: item.type,
      description: item.description,
      dependencies: item.dependencies,
      registryDependencies: item.registryDependencies.map(qualify),
      categories: item.categories,
      files: [] as object[],
    };
    if (item.cssVars !== undefined) outputItem.cssVars = item.cssVars;
    if (item.css !== undefined) outputItem.css = item.css;

    const files: object[] = [];

    for (const file of item.files ?? []) {
      const sourcePath = resolve(ROOT, file.path);

      if (!existsSync(sourcePath)) {
        console.error(`Source file not found: ${sourcePath} (item: ${item.name})`);
        process.exit(1);
      }

      const content = readFileSync(sourcePath, "utf-8");

      // Verify "use client" directive is preserved
      if (content.startsWith('"use client"') || content.startsWith("'use client'")) {
        // Good — directive present
      } else if (sourcePath.endsWith(".tsx") || sourcePath.endsWith(".ts")) {
        console.warn(`Warning: ${file.path} does not start with "use client" directive`);
      }

      files.push({
        type: file.type,
        path: file.target,
        // The CLI puts a registry:lib file in the app's lib/ unless told
        // otherwise; its component imports it from beside itself.
        target: file.target,
        content,
      });
    }

    outputItem.files = files;

    // Write individual item JSON
    const itemOutputPath = resolve(outputDir, `${item.name}.json`);
    mkdirSync(dirname(itemOutputPath), { recursive: true });
    writeFileSync(itemOutputPath, JSON.stringify(outputItem, null, 2));

    indexItems.push({
      name: item.name,
      title: item.title,
      type: item.type,
      description: item.description,
      dependencies: item.dependencies,
      registryDependencies: item.registryDependencies,
      categories: item.categories,
    });

    console.log(`  ✓ ${item.name}.json`);
  }

  // Write index.json
  const indexOutput = {
    $schema: registry.$schema,
    name: registry.name,
    homepage: registry.homepage,
    items: indexItems,
  };
  writeFileSync(resolve(outputDir, "index.json"), JSON.stringify(indexOutput, null, 2));
  console.log(`  ✓ index.json`);

  console.log(`\nBuilt ${registry.items.length} registry items to ${outputDir}`);
}

main();
