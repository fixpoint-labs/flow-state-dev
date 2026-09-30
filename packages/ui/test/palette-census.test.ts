/**
 * Every registry file paints only through tokens.
 *
 * Walks EVERY registry file, never a list: a list of the files known to carry
 * colours is how the next one ships. The walk is held to the manifest — every
 * file an item installs has to be among the walked files — so a walk that
 * silently reads the wrong directory, or nothing, fails instead of passing on
 * an empty set.
 *
 * The planted-file cases run the same census over a temp copy with one bad
 * file added, so the suite itself shows the census can fail.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { census, fixedColours, fixedCorners, tokenUtilities, registryFiles } from "./colour-rules";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS = resolve(ROOT, "registry/components");

interface Manifest {
  items: Array<{
    name: string;
    files?: Array<{ path: string }>;
    cssVars?: { theme?: Record<string, string> };
    css?: Record<string, Record<string, Record<string, string>>>;
  }>;
}

const manifest = JSON.parse(readFileSync(resolve(ROOT, "registry.json"), "utf8")) as Manifest;

/** The token names the `tokens` item defines, light and dark: `background`, `attention-foreground`, … */
function definedTokens(): { light: Set<string>; dark: Set<string>; theme: Set<string> } {
  const tokens = manifest.items.find((item) => item.name === "tokens");
  const base = tokens?.css?.["@layer base"] ?? {};
  const names = (block: Record<string, string> | undefined) =>
    new Set(Object.keys(block ?? {}).map((prop) => prop.replace(/^--/, "")));
  return {
    light: names(base[":root"]),
    dark: names(base[".dark"]),
    theme: new Set(Object.keys(tokens?.cssVars?.theme ?? {}).map((key) => key.replace(/^color-/, ""))),
  };
}

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("the colour census", () => {
  it("walks every file the manifest installs", () => {
    const walked = new Set(registryFiles(COMPONENTS));
    const shipped = manifest.items.flatMap((item) => (item.files ?? []).map((file) => resolve(ROOT, file.path)));
    expect(shipped.length).toBeGreaterThan(0);
    for (const file of shipped) expect(walked.has(file), `${file} is installed but not walked`).toBe(true);
    // More files than the manifest names, never fewer: files the manifest
    // does not install are still registry source and still walked.
    expect(walked.size).toBeGreaterThanOrEqual(new Set(shipped).size);
  });

  it("finds no fixed palette class or colour literal in any registry file", () => {
    const { walked, offenders } = census(COMPONENTS);
    expect(walked.length).toBeGreaterThan(0);
    expect(Object.fromEntries(offenders)).toEqual({});
  });

  it("fails on a planted palette class, naming the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "fsd-census-"));
    temps.push(dir);
    cpSync(COMPONENTS, dir, { recursive: true });
    writeFileSync(join(dir, "planted.tsx"), 'export const X = () => <span className="text-amber-500" />;\n');
    const { walked, offenders } = census(dir);
    expect(walked.length).toBe(registryFiles(COMPONENTS).length + 1);
    expect([...offenders.keys()]).toContain("planted.tsx");
    expect(offenders.get("planted.tsx")).toEqual(["text-amber-500"]);
  });

  it("counts a colour literal, but not a fully transparent one", () => {
    expect(fixedColours('style={{ color: "#123456" }}')).toEqual(["#123456"]);
    expect(fixedColours('style={{ color: "rgb(1, 2, 3)" }}')).toEqual(["rgb(1, 2, 3)"]);
    expect(fixedColours("mask: linear-gradient(#0000, #000)")).toEqual(["#000"]);
    expect(fixedColours('"text-white bg-black/50"')).toEqual(["text-white", "bg-black/50"]);
  });
});

describe("every token a component reads is defined by the tokens item", () => {
  it("defines each token utility in use, light and dark, and maps it for Tailwind", () => {
    const { light, dark, theme } = definedTokens();
    const missing: string[] = [];
    for (const file of registryFiles(COMPONENTS)) {
      for (const name of tokenUtilities(readFileSync(file, "utf8"))) {
        for (const [where, set] of [["light", light], ["dark", dark], ["theme", theme]] as const) {
          if (!set.has(name)) missing.push(`${name} (${where}) used by ${file.slice(COMPONENTS.length + 1)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("reads the token names a component uses, whatever the variant or opacity", () => {
    expect(tokenUtilities('"size-4 text-attention dark:bg-success/10 hover:bg-destructive/80"').sort()).toEqual([
      "attention",
      "destructive",
      "success",
    ]);
    expect(tokenUtilities('"bg-success text-success-foreground text-sm border-2"').sort()).toEqual([
      "success",
      "success-foreground",
    ]);
  });
});

describe("corners follow the radius tokens", () => {
  it("uses no corner class with a fixed size in any registry file", () => {
    const offenders = registryFiles(COMPONENTS)
      .map((file) => [file.slice(COMPONENTS.length + 1), fixedCorners(readFileSync(file, "utf8"))] as const)
      .filter(([, found]) => found.length > 0);
    expect(Object.fromEntries(offenders)).toEqual({});
  });

  it("finds a bare rounded, with or without a variant, and nothing else", () => {
    expect(fixedCorners('"shrink-0 rounded bg-muted [&_code]:rounded"')).toEqual(["rounded", "[&_code]:rounded"]);
    expect(fixedCorners('"rounded-sm rounded-md rounded-full rounded-l-md"')).toEqual([]);
  });
});
