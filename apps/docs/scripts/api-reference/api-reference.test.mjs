/**
 * The API reference generator's own behaviour, over scratch workspaces and the real one.
 *
 *   node --test apps/docs/scripts/api-reference/api-reference.test.mjs
 *
 * The section tests read the workspace's manifests. The render tests run the real generator
 * (TypeDoc in a child process per package) over tiny hand-written packages, so they prove what
 * a reader's page carries, not what a cache key holds.
 */
import assert from "node:assert/strict";
import { globSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { listSections } from "./packages.mjs";
import { generateApiReference } from "./generate.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const scratchRoots = [];
after(() => {
  for (const dir of scratchRoots) rmSync(dir, { recursive: true, force: true });
});

/**
 * A scratch workspace: `packages/<dir>` per entry, each with a manifest, a `dist/index.d.ts`
 * and `node_modules` links to the workspace packages it depends on, the way pnpm lays them out.
 *
 * @param {Record<string, { name?: string, private?: boolean, deps?: string[], dts?: string }>} packages by directory
 */
function scratchWorkspace(packages) {
  const root = mkdtempSync(join(tmpdir(), "api-reference-test-"));
  scratchRoots.push(root);
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  const nameOf = (dir) => packages[dir].name ?? `@t/${dir}`;
  for (const [dir, spec] of Object.entries(packages)) {
    const pkgDir = join(root, "packages", dir);
    mkdirSync(join(pkgDir, "dist"), { recursive: true });
    const deps = spec.deps ?? [];
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: nameOf(dir),
        version: "0.0.0",
        ...(spec.private ? { private: true } : {}),
        type: "module",
        exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
        dependencies: Object.fromEntries(deps.map((d) => [nameOf(d), "workspace:*"])),
      }),
    );
    if (spec.dts !== undefined) writeFileSync(join(pkgDir, "dist", "index.d.ts"), spec.dts);
    for (const dep of deps) {
      const link = join(pkgDir, "node_modules", ...nameOf(dep).split("/"));
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(join(root, "packages", dep), link, "dir");
    }
  }
  return root;
}

/** Runs the generator over a scratch workspace, its types already "built". */
function generate(root, extra = {}) {
  return generateApiReference({
    root,
    outDir: join(root, "out"),
    cacheDir: join(root, "cache"),
    skipTypes: true,
    log: () => {},
    ...extra,
  });
}

const pageOf = (root, slug) => readFileSync(join(root, "out", slug, "index.md"), "utf8");

describe("sections", () => {
  it("are exactly the sitemap's 27 slugs, so the reference's addresses are the ones the sitemap promised", () => {
    // The docs-revamp epic's sitemap, the one spec that holds the reference's slug table.
    const [sitemapFile] = globSync("specs/epics/*/SITEMAP/reference.md", { cwd: REPO_ROOT });
    const sitemap = readFileSync(join(REPO_ROOT, sitemapFile), "utf8");
    const table = sitemap.slice(sitemap.indexOf("## Generated API reference"));
    const promised = [...table.matchAll(/^\| `([a-z0-9-]+)` \| `@flow-state-dev\//gm)].map((m) => m[1]).sort();
    assert.equal(promised.length, 27);
    const { sections } = listSections(REPO_ROOT);
    assert.deepEqual(sections.map((s) => s.slug).sort(), promised);
  });

  it("come from the published packages, so a new one gets a section with no list to edit", () => {
    const root = scratchWorkspace({
      core: { name: "@flow-state-dev/core" },
      contracts: { name: "@flow-state-dev/contracts" },
      "brand-new": { name: "@flow-state-dev/brand-new" },
      ui: { name: "@flow-state-dev/ui", private: true },
    });
    const { sections, byName } = listSections(root);
    assert.deepEqual(sections.map((s) => s.slug).sort(), ["brand-new", "core"]);
    // Private packages and `contracts` have no section, but are still dependencies a key reads.
    assert.equal(byName.get("@flow-state-dev/ui").dir, join(root, "packages", "ui"));
    assert.equal(byName.get("@flow-state-dev/contracts").dir, join(root, "packages", "contracts"));
  });
});

describe("the render cache", () => {
  it("re-renders a section when a comment two workspace hops away changes, so CI's cache never serves the old text", async () => {
    const leaf = (sentence) => `/** ${sentence} */\nexport declare function leafThing(): void;\n`;
    const root = scratchWorkspace({
      leaf: { dts: leaf("The first sentence.") },
      middle: { deps: ["leaf"], dts: `export { leafThing } from "@t/leaf";\n/** Middle. */\nexport declare const middle: 1;\n` },
      top: { deps: ["middle"], dts: `export { leafThing } from "@t/middle";\n/** Top. */\nexport declare const top: 1;\n` },
    });
    await generate(root);
    assert.match(pageOf(root, "top"), /The first sentence\./);

    writeFileSync(join(root, "packages", "leaf", "dist", "index.d.ts"), leaf("The edited sentence."));
    const { sections } = await generate(root);
    assert.equal(sections.find((s) => s.slug === "top").cached, false);
    assert.match(pageOf(root, "top"), /The edited sentence\./);
    assert.doesNotMatch(pageOf(root, "top"), /The first sentence\./);
  });

  it("serves an unchanged section from the cache", async () => {
    const root = scratchWorkspace({ only: { dts: `/** Only. */\nexport declare const only: 1;\n` } });
    await generate(root);
    const { sections } = await generate(root);
    assert.equal(sections[0].cached, true);
  });
});

describe("a failing section", () => {
  it("stops the queue, so no render starts after the build has already failed", async () => {
    const good = { dts: `/** Fine. */\nexport declare const fine: 1;\n` };
    // `aaa` sorts first and has no declarations; eight good sections queue behind it.
    const packages = { aaa: {} };
    for (let i = 0; i < 8; i++) packages[`good-${i}`] = good;
    const root = scratchWorkspace(packages);
    await assert.rejects(generate(root), /cannot read @t\/aaa/);
    // Give every render a still-running queue would start time to begin.
    await new Promise((r) => setTimeout(r, 10_000));
    const started = readdirSync(join(root, "cache")).filter((d) => d.startsWith("good-"));
    // At most the renders already running beside `aaa` (the pool is at most 4 wide); never all 8.
    assert.ok(started.length <= 3, `${started.length} renders started: ${started.join(", ")}`);
  });
});

describe("a rendered page", () => {
  it("keeps a doc comment's code example as written, links and all", async () => {
    const root = scratchWorkspace({
      ex: {
        dts:
          "/**\n * Has an example.\n *\n * @example\n * ```ts\n * const doc = \"[label](#nowhere)\";\n * ```\n */\n" +
          "export declare function withExample(): void;\n",
      },
    });
    const { sections } = await generate(root);
    assert.match(pageOf(root, "ex"), /\[label\]\(#nowhere\)/);
    assert.deepEqual(sections[0].unlinked, []);
  });

  it("lists a comment's broken link as a warning for its package, without failing the build", async () => {
    const root = scratchWorkspace({
      linky: { dts: "/** See {@link NoSuchThing}. */\nexport declare function linky(): void;\n" },
    });
    const { sections } = await generate(root);
    assert.equal(sections[0].warnings.length, 1);
    assert.match(sections[0].warnings[0], /NoSuchThing/);
    const report = JSON.parse(readFileSync(join(root, "cache", "report.json"), "utf8"));
    assert.deepEqual(report["@t/linky"].warnings, sections[0].warnings);
  });
});
