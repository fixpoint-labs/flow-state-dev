/**
 * The layer line between fsdev and Workforce.
 *
 * fsdev's app hook, its generator hook and `@flow-state-dev/node`'s page
 * options are generic. An app that sits beside them (Shift Manager is one)
 * plugs its policy in as page meta, and Workforce supplies `fsdev gen`'s
 * generator as a dependency of the app; none of these modules imports
 * Workforce or that app, or names their concepts.
 *
 * Above the hooks, fsdev as a whole depends on no Layer 2 package: Workforce,
 * and every workspace package that depends on it, found from the manifests so
 * a new one is covered without editing this file.
 *
 * Reads source files and manifests. Each scan is also run on a planted
 * violation to prove it can fail.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const packages = resolve(import.meta.dirname, "..", "..");

/** The modules that make up the hook. */
const HOOK_MODULES = [
  "cli/src/commands/dev.ts",
  "cli/src/dev-app.ts",
  "cli/src/dev-vite.ts",
  "cli/src/dev-watch.ts",
  "cli/src/dev-watch-preload.ts",
  "cli/src/commands/gen.ts",
  "node/src/serve.ts",
  "node/src/page-html.ts",
  "node/src/devtool-config-injection.ts",
];

const FORBIDDEN_IMPORT = /from\s+["']@flow-state-dev\/(workforce|shift-manager)(\/[^"']*)?["']|import\(\s*["']@flow-state-dev\/(workforce|shift-manager)/;
const FORBIDDEN_WORD = /\b(teams?|workers?|rosters?|shifts?|seats?|workforce|shift[- ]manager)\b/i;

/** Each line of `source` that imports Workforce or Shift Manager, or names their concepts. */
function layerViolations(source: string): string[] {
  return source
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => FORBIDDEN_IMPORT.test(line) || FORBIDDEN_WORD.test(line))
    .map(({ line, n }) => `${n}: ${line.trim()}`);
}

describe("app hook layer line", () => {
  it.each(HOOK_MODULES)("%s imports no Workforce or Shift Manager module and names none of their concepts", (file) => {
    const source = readFileSync(resolve(packages, file), "utf8");
    expect(layerViolations(source)).toEqual([]);
  });

  it("flags a planted import and a planted word", () => {
    const source = readFileSync(resolve(packages, "cli/src/commands/dev.ts"), "utf8");
    expect(layerViolations(`${source}\nimport { hireWorkforce } from "@flow-state-dev/workforce";\n`)).toHaveLength(1);
    expect(layerViolations(`${source}\nconst x = await import("@flow-state-dev/shift-manager");\n`)).toHaveLength(1);
    expect(layerViolations(`${source}\n// pick the team's roster\n`)).toHaveLength(1);
  });
});

/** A workspace package's manifest, as far as these scans read it. */
interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(packages, dir, "package.json"), "utf8")) as Manifest;
}

/** Every package a manifest names, in any dependency field. */
function dependsOn(manifest: Manifest): string[] {
  return [
    manifest.dependencies,
    manifest.peerDependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
  ].flatMap((deps) => Object.keys(deps ?? {}));
}

/** Workforce and every workspace package that depends on it, directly or not. */
function layerTwo(manifests: Manifest[]): Set<string> {
  const found = new Set(["@flow-state-dev/workforce"]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const manifest of manifests) {
      if (!found.has(manifest.name) && dependsOn(manifest).some((name) => found.has(name))) {
        found.add(manifest.name);
        grew = true;
      }
    }
  }
  return found;
}

/** Every `.ts` file under `dir`, relative to `packages`. */
function sources(dir: string): string[] {
  return readdirSync(join(packages, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(entry.parentPath, entry.name).slice(packages.length + 1));
}

/** Each line of `source` importing one of `banned`, by any subpath, statically or not. */
function importsOf(source: string, banned: Set<string>): string[] {
  const specifier = /(?:from\s+|import\(\s*|require\(\s*)["']((?:@[^/"']+\/)?[^/"']+)(?:\/[^"']*)?["']/g;
  return source
    .split("\n")
    .flatMap((line, i) =>
      [...line.matchAll(specifier)]
        .filter((match) => banned.has(match[1]))
        .map(() => `${i + 1}: ${line.trim()}`),
    );
}

describe("fsdev and Layer 2", () => {
  const manifests = readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return [readManifest(entry.name)];
      } catch {
        return [];
      }
    });
  const banned = layerTwo(manifests);

  it("finds Workforce and what is built on it", () => {
    // Guards the scans below against passing on an empty set.
    expect(banned).toContain("@flow-state-dev/workforce");
    expect(banned).toContain("@flow-state-dev/shift-manager");
  });

  it("names no Layer 2 package in fsdev's manifest", () => {
    const fsdev = readManifest("cli");
    expect(dependsOn(fsdev).filter((name) => banned.has(name))).toEqual([]);
    expect(
      dependsOn({ ...fsdev, dependencies: { ...fsdev.dependencies, "@flow-state-dev/workforce": "workspace:*" } })
        .filter((name) => banned.has(name)),
    ).toEqual(["@flow-state-dev/workforce"]);
  });

  it.each(sources("cli/src"))("%s imports no Layer 2 package", (file) => {
    expect(importsOf(readFileSync(resolve(packages, file), "utf8"), banned)).toEqual([]);
  });

  it("flags a planted import of each kind", () => {
    const source = readFileSync(resolve(packages, "cli/src/commands/gen.ts"), "utf8");
    expect(importsOf(`${source}\nimport { x } from "@flow-state-dev/workforce/codegen";\n`, banned)).toHaveLength(1);
    expect(importsOf(`${source}\nconst m = await import("@flow-state-dev/shift-manager");\n`, banned)).toHaveLength(1);
    expect(importsOf(`${source}\nimport type { Y } from "@flow-state-dev/workforce";\n`, banned)).toHaveLength(1);
  });
});
