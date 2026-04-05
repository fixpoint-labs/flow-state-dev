/**
 * Compiles registry.json into individual JSON files in public/r/.
 *
 * Each registry item gets its own JSON file following the shadcn registry-item schema,
 * with source files embedded as `content` strings. An index.json is also generated
 * containing the full registry manifest.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const REGISTRY_PATH = resolve(ROOT, "registry.json");
const OUTPUT_DIR = resolve(ROOT, "public", "r");

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
  files: RegistryFile[];
  categories: string[];
}

interface Registry {
  $schema: string;
  name: string;
  homepage: string;
  items: RegistryItem[];
}

function main() {
  if (!existsSync(REGISTRY_PATH)) {
    console.error("registry.json not found at", REGISTRY_PATH);
    process.exit(1);
  }

  const registry: Registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

  // Ensure output directory exists
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const indexItems: object[] = [];

  for (const item of registry.items) {
    const outputItem: Record<string, unknown> = {
      name: item.name,
      title: item.title,
      type: item.type,
      description: item.description,
      dependencies: item.dependencies,
      registryDependencies: item.registryDependencies,
      categories: item.categories,
      files: [] as object[],
    };

    const files: object[] = [];

    for (const file of item.files) {
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
        content,
      });
    }

    outputItem.files = files;

    // Write individual item JSON
    const itemOutputPath = resolve(OUTPUT_DIR, `${item.name}.json`);
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
  writeFileSync(resolve(OUTPUT_DIR, "index.json"), JSON.stringify(indexOutput, null, 2));
  console.log(`  ✓ index.json`);

  console.log(`\nBuilt ${registry.items.length} registry items to ${OUTPUT_DIR}`);
}

main();
