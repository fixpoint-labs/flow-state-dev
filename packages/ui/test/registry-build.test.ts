import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = resolve(ROOT, "public", "r");
const REGISTRY_PATH = resolve(ROOT, "registry.json");

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

describe("registry build", () => {
  let registry: Registry;

  beforeAll(() => {
    // Run the build
    execSync("npx tsx scripts/build-registry.ts", { cwd: ROOT });
    registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  });

  it("produces an index.json", () => {
    expect(existsSync(resolve(OUTPUT_DIR, "index.json"))).toBe(true);
  });

  it("produces a JSON file for each registry item", () => {
    for (const item of registry.items) {
      const outputPath = resolve(OUTPUT_DIR, `${item.name}.json`);
      expect(existsSync(outputPath), `Missing: ${item.name}.json`).toBe(true);
    }
  });

  it("each item JSON contains embedded source content", () => {
    for (const item of registry.items) {
      if (item.type === "registry:theme") continue;
      const outputPath = resolve(OUTPUT_DIR, `${item.name}.json`);
      const built = JSON.parse(readFileSync(outputPath, "utf-8"));

      expect(built.files).toBeDefined();
      expect(built.files.length).toBeGreaterThan(0);

      for (const file of built.files) {
        expect(file.content).toBeDefined();
        expect(typeof file.content).toBe("string");
        expect(file.content.length).toBeGreaterThan(0);
      }
    }
  });

  it("preserves 'use client' directive when present in source", () => {
    for (const item of registry.items) {
      const outputPath = resolve(OUTPUT_DIR, `${item.name}.json`);
      const built = JSON.parse(readFileSync(outputPath, "utf-8"));

      for (const file of built.files) {
        if (!file.path.endsWith(".tsx")) continue;

        // Read the original source file to check if it has "use client"
        const sourcePath = resolve(ROOT, item.files[0].path);
        const sourceContent = readFileSync(sourcePath, "utf-8");
        const sourceHasDirective = sourceContent.startsWith('"use client"');

        if (sourceHasDirective) {
          expect(
            file.content.startsWith('"use client"'),
            `${item.name}: "use client" directive was stripped from ${file.path}`
          ).toBe(true);
        }
      }
    }
  });

  it("all referenced source files exist in the registry", () => {
    for (const item of registry.items) {
      for (const file of item.files ?? []) {
        const sourcePath = resolve(ROOT, file.path);
        expect(
          existsSync(sourcePath),
          `Source file missing: ${file.path} (item: ${item.name})`
        ).toBe(true);
      }
    }
  });

  it("each item has required fields", () => {
    for (const item of registry.items) {
      expect(item.name).toBeTruthy();
      expect(item.title).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(Array.isArray(item.dependencies)).toBe(true);
      expect(Array.isArray(item.registryDependencies)).toBe(true);
      if (item.type === "registry:theme") {
        // A theme carries tokens, not files.
        expect(item.css ?? item.cssVars).toBeDefined();
        continue;
      }
      expect(item.type).toBe("registry:component");
      expect(Array.isArray(item.files)).toBe(true);
      expect(item.files.length).toBeGreaterThan(0);
    }
  });

  it("writes a dependency on another item in this registry as that item's URL", () => {
    // The shadcn CLI looks a bare name up in ITS registry, so a bare "tokens"
    // would 404 on ui.shadcn.com instead of installing ours.
    const ownNames = new Set(registry.items.map((item) => item.name));
    for (const item of registry.items) {
      const built = JSON.parse(readFileSync(resolve(OUTPUT_DIR, `${item.name}.json`), "utf-8"));
      item.registryDependencies.forEach((dep, i) => {
        expect(built.registryDependencies[i]).toBe(
          ownNames.has(dep) ? `https://ui.flow-state.dev/r/${dep}.json` : dep
        );
      });
    }
    const tool = JSON.parse(readFileSync(resolve(OUTPUT_DIR, "tool.json"), "utf-8"));
    expect(tool.registryDependencies).toContain("https://ui.flow-state.dev/r/tokens.json");
    expect(tool.registryDependencies).toContain("collapsible");
  });

  it("tells the CLI where every file goes, so a helper lands beside the component importing it", () => {
    // Without a target the CLI puts a registry:lib file in the app's lib/,
    // while the component that ships with it imports it as "./<name>".
    for (const item of registry.items) {
      const built = JSON.parse(readFileSync(resolve(OUTPUT_DIR, `${item.name}.json`), "utf-8"));
      (item.files ?? []).forEach((file, i) => {
        expect(built.files[i].target).toBe(file.target);
      });
    }
    const tool = JSON.parse(readFileSync(resolve(OUTPUT_DIR, "tool.json"), "utf-8"));
    const helper = tool.files.find((f: { type: string }) => f.type === "registry:lib");
    expect(helper.target).toBe("components/flow-state/tool-grouping.ts");
  });

  it("emits the tokens item's CSS, light and dark", () => {
    const tokens = JSON.parse(readFileSync(resolve(OUTPUT_DIR, "tokens.json"), "utf-8"));
    expect(tokens.cssVars.theme["color-attention"]).toBe("var(--attention)");
    expect(tokens.css["@layer base"][":root"]["--attention"]).toBeTruthy();
    expect(tokens.css["@layer base"][".dark"]["--attention"]).toBeTruthy();
  });

  it("builds against another base URL into another directory", () => {
    const out = mkdtempSync(join(tmpdir(), "fsd-registry-"));
    try {
      execSync(`npx tsx scripts/build-registry.ts --base-url http://127.0.0.1:9/r/ --out ${out}`, { cwd: ROOT });
      const tool = JSON.parse(readFileSync(resolve(out, "tool.json"), "utf-8"));
      expect(tool.registryDependencies).toContain("http://127.0.0.1:9/r/tokens.json");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
    // Spawns the build; under a parallel test run that alone can pass 5s.
  }, 30_000);

  it("index.json contains all items", () => {
    const index = JSON.parse(readFileSync(resolve(OUTPUT_DIR, "index.json"), "utf-8"));
    expect(index.items.length).toBe(registry.items.length);

    const indexNames = new Set(index.items.map((i: { name: string }) => i.name));
    for (const item of registry.items) {
      expect(indexNames.has(item.name), `index.json missing: ${item.name}`).toBe(true);
    }
  });
});
