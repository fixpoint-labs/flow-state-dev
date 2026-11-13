/**
 * The API reference's sections: one per published package, at `reference/api/<slug>`, where
 * the slug is the package's directory under `packages/`.
 *
 * Derived, not listed: every workspace member under `packages/` that is not `private` gets a
 * section, so a new package can't ship without one and a removed one can't leave a section
 * building nothing. `@flow-state-dev/ui` is private (a registry, not an import) and so has
 * none. `@flow-state-dev/contracts` is the one published package without a section: `core`
 * re-exports it and a reader imports it from `core`, so its exports read under `core`.
 *
 * The workspace is read through the repository's one workspace parser, and a subpath is
 * public by the same rule the root-exports check uses.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isInternalSubpath } from "../../../../scripts/import-census.mjs";
import { workspaceManifests } from "../../../../scripts/workspace-members.mjs";

/** Published packages that deliberately have no section, and where their reference lives. */
const NO_SECTION = {
  "@flow-state-dev/contracts": "reads under core, which re-exports it",
};

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
 * Every section, sorted by slug, and every workspace package's name → its directory and
 * manifest (private ones included: they can be dependencies a section's cache key reads).
 * Each manifest is read once.
 *
 * @param {string} root the repository root
 * @returns {{
 *   sections: { slug: string, dir: string, pkg: Record<string, any>, entries: { subpath: string, types: string }[] }[],
 *   byName: Map<string, { dir: string, pkg: Record<string, any> }>,
 * }}
 */
export function listSections(root) {
  const byName = new Map();
  const sections = [];
  for (const manifest of workspaceManifests(root)) {
    if (!manifest.startsWith("packages/")) continue;
    const dir = join(root, dirname(manifest));
    const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8"));
    byName.set(pkg.name, { dir, pkg });
    if (pkg.private || pkg.name in NO_SECTION) continue;
    sections.push({ slug: dirname(manifest).slice("packages/".length), dir, pkg, entries: publicEntries(pkg) });
  }
  sections.sort((a, b) => a.slug.localeCompare(b.slug));
  return { sections, byName };
}
