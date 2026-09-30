/**
 * Every registry item installs what its files need.
 *
 * Two assertions over ITEMS, kept apart from the census, which is over files:
 *
 *  1. Every relative import in an item's files resolves to a file that item,
 *     or an item in its registry-dependency closure, ships. Otherwise
 *     `fsdev ui add <item>` writes a file that imports one it never wrote.
 *  2. Every file that reads a status token ships in an item whose closure
 *     includes `tokens`, so the token defaults arrive with the first component
 *     that needs them.
 *
 * The rule the manifest follows is "a file another registry file imports ships
 * in the importing item; a file nothing imports is its own item" — this holds
 * it, so a new file can't ship uninstallable. Planted cases run the same check
 * over an edited manifest to show it can fail.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readsStatusToken, registryFiles, relativeImports } from "./colour-rules";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS = resolve(ROOT, "registry/components");

interface Item {
  name: string;
  registryDependencies: string[];
  files?: Array<{ path: string }>;
}

const manifest = JSON.parse(readFileSync(resolve(ROOT, "registry.json"), "utf8")) as { items: Item[] };

/** Every item reachable from `name` through registry dependencies that name another item in this registry. */
function closure(items: Item[], name: string): Item[] {
  const byName = new Map(items.map((item) => [item.name, item]));
  const seen = new Map<string, Item>();
  const visit = (current: string) => {
    const item = byName.get(current);
    if (item === undefined || seen.has(current)) return;
    seen.set(current, item);
    for (const dep of item.registryDependencies) visit(dep);
  };
  visit(name);
  return [...seen.values()];
}

/** Unshipped imports, as `<item>: <file> imports <target>`. */
function unshippedImports(items: Item[], read: (path: string) => string, exists: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const item of items) {
    const shipped = new Set(closure(items, item.name).flatMap((i) => (i.files ?? []).map((f) => resolve(ROOT, f.path))));
    for (const file of item.files ?? []) {
      const path = resolve(ROOT, file.path);
      for (const target of relativeImports(path, read(path), exists)) {
        if (!shipped.has(target)) out.push(`${item.name}: ${file.path} imports ${target.slice(ROOT.length + 1)}`);
      }
    }
  }
  return out;
}

/** Status-token readers not installed with `tokens`, as a relative path. */
function tokenReadersWithoutTokens(items: Item[], files: string[], read: (path: string) => string): string[] {
  const out: string[] = [];
  for (const file of files) {
    if (!readsStatusToken(read(file))) continue;
    const owners = items.filter((item) => (item.files ?? []).some((f) => resolve(ROOT, f.path) === file));
    const covered = owners.some((owner) => closure(items, owner.name).some((i) => i.name === "tokens"));
    if (!covered) out.push(file.slice(ROOT.length + 1));
  }
  return out;
}

const read = (path: string) => readFileSync(path, "utf8");

describe("registry reachability", () => {
  it("ships every file an item's files import", () => {
    expect(unshippedImports(manifest.items, read, existsSync)).toEqual([]);
  });

  it("installs tokens with every file that reads a status token", () => {
    const readers = registryFiles(COMPONENTS).filter((file) => readsStatusToken(read(file)));
    expect(readers.length).toBeGreaterThan(0);
    expect(tokenReadersWithoutTokens(manifest.items, registryFiles(COMPONENTS), read)).toEqual([]);
  });

  it("fails on a planted import of a file no item ships, naming it", () => {
    const planted = resolve(COMPONENTS, "planted.tsx");
    const items: Item[] = [
      ...manifest.items,
      { name: "planted", registryDependencies: [], files: [{ path: "registry/components/planted.tsx" }] },
    ];
    const reader = (path: string) => (path === planted ? 'import { X } from "./not-shipped";\n' : read(path));
    const exists = (path: string) => path === planted || existsSync(path);
    expect(unshippedImports(items, reader, exists)).toEqual([
      "planted: registry/components/planted.tsx imports registry/components/not-shipped",
    ]);
  });

  it("fails on a status-token reader whose item does not reach tokens, naming it", () => {
    const planted = resolve(COMPONENTS, "planted.tsx");
    const items: Item[] = [
      ...manifest.items,
      { name: "planted", registryDependencies: [], files: [{ path: "registry/components/planted.tsx" }] },
    ];
    const reader = (path: string) => (path === planted ? '<span className="text-attention" />' : read(path));
    expect(tokenReadersWithoutTokens(items, [planted], reader)).toEqual(["registry/components/planted.tsx"]);
  });
});
