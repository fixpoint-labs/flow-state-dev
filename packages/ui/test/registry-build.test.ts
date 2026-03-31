import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
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

  it("preserves 'use client' directive in embedded source", () => {
    for (const item of registry.items) {
      const outputPath = resolve(OUTPUT_DIR, `${item.name}.json`);
      const built = JSON.parse(readFileSync(outputPath, "utf-8"));

      for (const file of built.files) {
        if (file.path.endsWith(".tsx")) {
          expect(
            file.content.startsWith('"use client"'),
            `${item.name}: "use client" directive missing in ${file.path}`
          ).toBe(true);
        }
      }
    }
  });

  it("all referenced source files exist in the registry", () => {
    for (const item of registry.items) {
      for (const file of item.files) {
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
      expect(item.type).toBe("registry:component");
      expect(item.description).toBeTruthy();
      expect(Array.isArray(item.dependencies)).toBe(true);
      expect(Array.isArray(item.registryDependencies)).toBe(true);
      expect(Array.isArray(item.files)).toBe(true);
      expect(item.files.length).toBeGreaterThan(0);
    }
  });

  it("index.json contains all items", () => {
    const index = JSON.parse(readFileSync(resolve(OUTPUT_DIR, "index.json"), "utf-8"));
    expect(index.items.length).toBe(registry.items.length);

    const indexNames = new Set(index.items.map((i: { name: string }) => i.name));
    for (const item of registry.items) {
      expect(indexNames.has(item.name), `index.json missing: ${item.name}`).toBe(true);
    }
  });
});
