/**
 * The import census: who imports which `@flow-state-dev/*` names, from which files.
 *
 * One module, so every check that asks "does anything outside the framework use this?"
 * reads imports the same way: the root-export check (`check-root-exports.mjs`), FIX-2162's
 * caller census (`goals/client/does-every-job-with-one-client/check.mjs`), and the checks
 * that later read the same census. It reads through a `mechanism-exports.mjs` reader, so
 * it runs on the working tree or on any commit.
 *
 * Where a file sits decides what its import means (FIX-2448 D1, the epic's ER-1 reading):
 *   adopter   `apps/` (not `apps/docs/` or `apps/devtool/`), `examples/`, `labs/`: code shaped
 *             like an app someone builds on FSD
 *   docs      `apps/docs/`: the docs site's pages and their code blocks
 *   ours      everything else (`packages/`, `goals/`, `scripts/`, ...): our own wiring,
 *             which never counts as a use
 * Retained history (`specs/`, `docs/internal/`, `.changeset/`, CHANGELOGs) is never read.
 *
 * Every import form counts: `import`, `import type`, `export … from`, a side-effect
 * `import "…"`, `import()` (including `typeof import()`), and `require()`.
 */

/** Retained history: never rewritten, never a caller. */
export const isHistory = (f) =>
  f.startsWith("specs/") || f.startsWith("docs/internal/") || f.startsWith(".changeset/") || /(^|\/)CHANGELOG\.md$/.test(f);

/** Code shaped like an adopter's app. */
export const isAdopter = (f) => /^(apps\/(?!docs\/|devtool\/)|examples\/|labs\/)/.test(f);

/** The docs site. */
export const isDocsSite = (f) => f.startsWith("apps/docs/");

/** Where a file's imports count: "adopter", "docs", or "ours". */
export const areaOf = (f) => (isAdopter(f) ? "adopter" : isDocsSite(f) ? "docs" : "ours");

/** Whether a subpath (`"/internal"`, `"/items/internal"`, `""` for the root) is an `/internal` one. */
export const isInternalSubpath = (sub) => /(^|\/)internal(\/|$)/.test(sub);

/**
 * Every tracked file `keep` accepts, with its text: path → text. Retained history is
 * included, for a census that counts it separately; filter it with `isHistory`.
 * A file the reader can't read (deleted in the working tree) is left out.
 */
export function readCorpus(read, keep = () => true) {
  const out = {};
  for (const f of read.tracked()) {
    if (!keep(f)) continue;
    const text = read(f);
    if (text != null) out[f] = text;
  }
  return out;
}

const PKG = String.raw`(@flow-state-dev\/[\w.-]+)(\/[^"'\s]*)?`;
// import / import type / export … from. Groups: type, default binding, brace list, `* as` name, package, subpath.
const STATIC_RE = new RegExp(String.raw`\b(?:import|export)\s+(type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|\*)?\s*from\s*["']` + PKG + `["']`, "g");
// import "…" with no bindings.
const SIDE_EFFECT_RE = new RegExp(String.raw`\bimport\s*["']` + PKG + `["']`, "g");
// import("…"), typeof import("…"), require("…"), import x = require("…").
const CALL_RE = new RegExp(String.raw`\b(import|require)\s*\(\s*["']` + PKG + String.raw`["']\s*\)`, "g");

const bindingNames = (list) =>
  (list ?? "").split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim()).filter(Boolean);

/**
 * Every `@flow-state-dev/*` import in `text`: { pkg, sub, names, form }. `sub` is `""` for a
 * root import. `names` are the root's names the import takes: the brace list, `default` for
 * a default binding, and each `ns.name` the file reads off a namespace import. A bare `export *`,
 * a side-effect import and a call form take no names.
 */
export function importsIn(text) {
  const out = [];
  for (const m of text.matchAll(STATIC_RE)) {
    const [, type, def, list, ns, pkg, sub = ""] = m;
    const names = bindingNames(list);
    if (def) names.push("default");
    if (ns) for (const [, n] of text.matchAll(new RegExp(String.raw`\b${ns.replace(/\$/g, "\\$")}\.([A-Za-z_$][\w$]*)`, "g"))) names.push(n);
    out.push({ pkg, sub, names, form: type ? "import type" : m[0].startsWith("export") ? "export from" : "import" });
  }
  for (const m of text.matchAll(SIDE_EFFECT_RE)) out.push({ pkg: m[1], sub: m[2] ?? "", names: [], form: "import" });
  for (const m of text.matchAll(CALL_RE)) out.push({ pkg: m[2], sub: m[3] ?? "", names: [], form: m[1] === "require" ? "require()" : "import()" });
  return out;
}

/**
 * Who imports each package root's names, and which adopter or docs files import an
 * `/internal` subpath. Reads only the adopter and docs files that mention the scope.
 *
 * Returns `{ uses, internalImports }`:
 *   uses             package name → export name → Set of areas ("adopter" | "docs") importing it from the root
 *   internalImports  [{ file, spec, form }], one per import of any `@flow-state-dev/<pkg>/…internal…` path
 */
export function importCensus(read) {
  const uses = new Map();
  const internalImports = [];
  const files = read.grep("@flow-state-dev/", ["apps", "examples", "labs"]).filter((f) => !isHistory(f) && areaOf(f) !== "ours");
  for (const file of files) {
    const text = read(file);
    if (text == null) continue;
    const area = areaOf(file);
    for (const { pkg, sub, names, form } of importsIn(text)) {
      if (isInternalSubpath(sub)) internalImports.push({ file, spec: pkg + sub, form });
      if (sub) continue;
      if (!uses.has(pkg)) uses.set(pkg, new Map());
      const byName = uses.get(pkg);
      for (const n of names) {
        if (!byName.has(n)) byName.set(n, new Set());
        byName.get(n).add(area);
      }
    }
  }
  return { uses, internalImports };
}
