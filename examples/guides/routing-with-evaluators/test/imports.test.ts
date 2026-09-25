// The example is what a reader copies, so it may only import what a reader
// can install: published `@flow-state-dev/*` packages, `ai`, a provider
// package, `zod`, Node built-ins, and its own files. An import that reaches
// into the kitchen-sink, a lab, the goals or a package's source would teach an
// API nobody can install. Test files and the vitest config may also import
// `vitest`.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const exampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PUBLISHED = /^@flow-state-dev\/[a-z0-9-]+(\/.*)?$/;
const ALLOWED_BARE = [/^ai(\/.*)?$/, /^@ai-sdk\/[a-z0-9-]+(\/.*)?$/, /^zod(\/.*)?$/, /^node:/];
const DEV_ONLY = [/^vitest(\/.*)?$/];
const SKIP = new Set(["node_modules", "dist", "build", ".turbo", "coverage"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(c|m)?(t|j)sx?$/.test(entry.name) ? [full] : [];
  });
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  // Static imports and re-exports start a line; a multi-line import's `from`
  // clause is matched on its own line. Dynamic imports and require can be anywhere.
  const patterns = [
    /^\s*import\s+(?:type\s+)?[^'"]*?\bfrom\s*["']([^"'\s]+)["']/gm,
    /^\s*import\s*["']([^"'\s]+)["']/gm,
    /^\s*export\s+(?:type\s+)?[^'"]*?\bfrom\s*["']([^"'\s]+)["']/gm,
    /^\s*\}\s*from\s*["']([^"'\s]+)["']/gm,
    /\bimport\s*\(\s*["']([^"'\s]+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"'\s]+)["']\s*\)/g,
  ];
  for (const pattern of patterns) for (const m of source.matchAll(pattern)) found.push(m[1]!);
  return found;
}

/** Every import in `root` that the fence refuses, as `file: specifier`. */
function violations(root: string): string[] {
  const out: string[] = [];
  for (const file of sourceFiles(root)) {
    const rel = path.relative(root, file);
    const devFile = rel.startsWith(`test${path.sep}`) || rel.startsWith("vitest.config.");
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) {
        const target = path.resolve(path.dirname(file), spec);
        if (target === root || target.startsWith(root + path.sep)) continue;
      } else if (PUBLISHED.test(spec) || ALLOWED_BARE.some((re) => re.test(spec))) {
        continue;
      } else if (devFile && DEV_ONLY.some((re) => re.test(spec))) {
        continue;
      }
      out.push(`${rel}: ${spec}`);
    }
  }
  return out;
}

/** A one-line import of `spec`, spelled so this file's own scan doesn't read it as one. */
const importOf = (spec: string) => `${"imp"}ort x from "${spec}";\n`;

const planted: string[] = [];
function plant(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "routing-fence-"));
  planted.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}
afterAll(() => planted.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("import fence", () => {
  it("the example imports only published packages and its own files", () => {
    const files = sourceFiles(exampleDir).map((f) => path.relative(exampleDir, f));
    // The walk must reach the root config and the sources, or it proves nothing.
    expect(files).toContain("fsdev.config.ts");
    expect(files).toContain(path.join("src", "route.ts"));
    expect(specifiers(readFileSync(path.join(exampleDir, "fsdev.config.ts"), "utf8"))).toEqual(
      expect.arrayContaining(["@flow-state-dev/engine", "./src/flow", "./src/models"]),
    );
    expect(violations(exampleDir)).toEqual([]);
  });

  it("refuses a kitchen-sink import in src/", () => {
    const root = plant({ "src/leak.ts": importOf("../../../apps/kitchen-sink/lib/x") });
    expect(violations(root)).toEqual([`${path.join("src", "leak.ts")}: ../../../apps/kitchen-sink/lib/x`]);
  });

  it("refuses a lab import in fsdev.config.ts", () => {
    const root = plant({ "fsdev.config.ts": importOf("../../../labs/system-one/src") });
    expect(violations(root)).toEqual(["fsdev.config.ts: ../../../labs/system-one/src"]);
  });

  it("refuses a package's source reached by path, and an unpublished bare import", () => {
    const root = plant({
      "src/a.ts": importOf("../../../../packages/core/src/blocks/evaluator"),
      "src/b.ts": importOf("labs/system-one"),
    });
    expect(violations(root).sort()).toEqual([
      `${path.join("src", "a.ts")}: ../../../../packages/core/src/blocks/evaluator`,
      `${path.join("src", "b.ts")}: labs/system-one`,
    ]);
  });

  it("allows a sibling import inside the example", () => {
    const root = plant({ "src/flow.ts": importOf("./route"), "src/route.ts": "export {};\n" });
    expect(violations(root)).toEqual([]);
  });
});
