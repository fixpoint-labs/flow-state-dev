/**
 * The API reference's sections: one per published package, at `reference/api/<slug>`.
 *
 * The slug table is the docs-revamp sitemap's (specs/epics/FIX-2696/SITEMAP/reference.md,
 * "Generated API reference"). Twenty-seven sections for twenty-eight published packages:
 * `@flow-state-dev/contracts` has no section of its own, because `core` re-exports it and a
 * reader imports it from `core`, so its exports read under `core`. `@flow-state-dev/ui` is a
 * registry, not an import, and has no section here.
 *
 * `listSections` also checks the table against the workspace: a published package with no
 * row, or a row with no published package, fails the build by name, so a new package can't
 * ship without a reference section and a removed one can't leave a section building nothing.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Slug under `reference/api/` → package directory under `packages/`. */
const SECTIONS = [
  { slug: "core", dir: "core" },
  { slug: "engine", dir: "engine" },
  { slug: "client", dir: "client" },
  { slug: "react", dir: "react" },
  { slug: "testing", dir: "testing" },
  { slug: "fsdev", dir: "fsdev" },
  { slug: "devtool", dir: "devtool" },
  { slug: "node", dir: "node" },
  { slug: "next", dir: "next" },
  { slug: "vercel", dir: "vercel" },
  { slug: "bullmq", dir: "bullmq" },
  { slug: "mcp", dir: "mcp" },
  { slug: "scheduled", dir: "scheduled" },
  { slug: "store-sqlite", dir: "store-sqlite" },
  { slug: "store-postgres", dir: "store-postgres" },
  { slug: "orchestration", dir: "orchestration" },
  { slug: "patterns", dir: "patterns" },
  { slug: "tools", dir: "tools" },
  { slug: "workspace", dir: "workspace" },
  { slug: "memory", dir: "memory" },
  { slug: "workforce", dir: "workforce" },
  { slug: "harness-manager", dir: "harness-manager" },
  { slug: "claude-code", dir: "claude-code" },
  { slug: "codex", dir: "codex" },
  { slug: "cursor", dir: "cursor" },
  { slug: "shift-manager", dir: "shift-manager" },
  { slug: "voice-openai", dir: "voice-openai" },
];

/** Published packages that deliberately have no section, and where their reference lives. */
const NO_SECTION = {
  "@flow-state-dev/contracts": "reads under core, which re-exports it",
};

/** A subpath is internal when any segment is `internal`, the same rule `check-root-exports.mjs` uses. */
const isInternalSubpath = (sub) => /(^|\/)internal(\/|$)/.test(sub);

/**
 * The `.d.ts` entry of each public, non-internal subpath a package publishes, read from the
 * `exports` it publishes (`publishConfig.exports` when it has one). Subpaths with no types
 * entry (a stylesheet) are skipped. The root (`.`) comes first.
 *
 * @param {Record<string, unknown>} pkg a parsed package.json
 * @returns {{ subpath: string, types: string }[]}
 */
function publicEntries(pkg) {
  const exportsMap = pkg.publishConfig?.exports ?? pkg.exports ?? {};
  const out = [];
  for (const [key, value] of Object.entries(exportsMap)) {
    const subpath = key === "." ? "." : key.replace(/^\.\//, "");
    if (subpath !== "." && isInternalSubpath(subpath)) continue;
    const types = typeof value === "object" && value !== null ? value.types : undefined;
    if (typeof types !== "string" || !types.endsWith(".d.ts")) continue;
    out.push({ subpath, types });
  }
  return out.sort((a, b) => (a.subpath === "." ? -1 : b.subpath === "." ? 1 : 0));
}

/**
 * Every section, with its package read from the workspace at `root`. Throws, naming the
 * package, when the table and the workspace's published packages disagree.
 *
 * @param {string} root the repository root
 */
export function listSections(root) {
  const packagesDir = join(root, "packages");
  const published = new Map();
  for (const dir of readdirSync(packagesDir)) {
    const file = join(packagesDir, dir, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    if (pkg.private) continue;
    published.set(dir, pkg);
  }
  const sections = SECTIONS.map(({ slug, dir }) => {
    const pkg = published.get(dir);
    if (!pkg) {
      throw new Error(
        `API reference: section "${slug}" names packages/${dir}, which is not a published package.`,
      );
    }
    return { slug, dir: join(packagesDir, dir), pkg, entries: publicEntries(pkg) };
  });
  const covered = new Set(SECTIONS.map((s) => s.dir));
  for (const [dir, pkg] of published) {
    if (covered.has(dir) || pkg.name in NO_SECTION) continue;
    throw new Error(
      `API reference: ${pkg.name} is published but has no section. Add it to SECTIONS in apps/docs/scripts/api-reference/packages.mjs.`,
    );
  }
  return sections;
}
