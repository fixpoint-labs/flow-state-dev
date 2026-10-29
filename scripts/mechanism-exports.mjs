/**
 * The public exports of every workspace package, read from source.
 *
 * Shared by the anchor check and the PR classifier. A package's public surface is
 * what its `package.json` `exports` map points at; each entry file is parsed (syntax
 * only, no type-check) and its re-exports are followed to the file that declares
 * the name, across workspace packages too. No build and no graft index needed.
 *
 * A reader is `read(path) → text | null` plus `read.packageDirs()` and `read.list(dir)`
 * (every file under a directory, for wildcard subpaths), so the same
 * walk runs on the working tree or on another commit (`git show <ref>:<path>`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";

/** Read files from the working tree under `root`. */
export const fsReader = (root) => {
  const read = (path) => { try { return readFileSync(join(root, path), "utf8"); } catch { return null; } };
  read.packageDirs = () => readdirSync(join(root, "packages"));
  read.list = (dir) => { try { return readdirSync(join(root, dir), { recursive: true }).map((f) => join(dir, f)); } catch { return []; } };
  return read;
};

/** Read files as they were at git `ref`. */
export const gitReader = (root, ref) => {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  const read = (path) => { try { return git(["show", `${ref}:${path}`]); } catch { return null; } };
  read.packageDirs = () => git(["ls-tree", "--name-only", `${ref}:packages`]).split("\n").filter(Boolean);
  read.list = (dir) => { try { return git(["ls-tree", "-r", "--name-only", ref, "--", `${dir}/`]).split("\n").filter(Boolean); } catch { return []; } };
  return read;
};

const EXT = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];
function resolveRelative(read, fromFile, spec) {
  const base = normalize(join(dirname(fromFile), spec)).replace(/\.(m?js|jsx)$/, "");
  for (const ext of EXT) if (/\.[mc]?tsx?$/.test(base + ext) && read(base + ext) != null) return base + ext;
  return null;
}

/** name → { file, type }: the declaring file, and whether the name is type-only. `w` is { read, memo, bare, dirs }. */
function moduleExports(w, file) {
  if (w.memo.has(file)) return w.memo.get(file);
  const out = new Map();
  w.memo.set(file, out);
  const text = w.read(file);
  if (text == null) return out;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const imports = new Map(); // local name → [module file, imported name]
  const from = (node) => {
    const spec = node.moduleSpecifier?.text;
    if (!spec) return null;
    if (spec.startsWith(".")) return resolveRelative(w.read, file, spec);
    if (w.bare.has(spec)) return w.bare.get(spec);
    // A deep import the exports map doesn't list (`@flow-state-dev/contracts/items/internal`)
    // resolves under that package's src/, as tsconfig.base.json's paths do.
    const [, name, sub] = /^(@[^/]+\/[^/]+)\/(.+)$/.exec(spec) ?? [];
    return w.dirs.has(name) ? resolveRelative(w.read, `packages/${w.dirs.get(name)}/src/x`, `./${sub}`) : null;
  };
  for (const node of sf.statements) {
    if (ts.isImportDeclaration(node)) {
      const mod = from(node);
      const b = node.importClause?.namedBindings;
      if (mod && b && ts.isNamedImports(b)) for (const el of b.elements) imports.set(el.name.text, [mod, (el.propertyName ?? el.name).text]);
      if (mod && node.importClause?.name) imports.set(node.importClause.name.text, [mod, "default"]); // import foo from "./foo"
    } else if (ts.isExportDeclaration(node)) {
      const mod = from(node);
      if (!node.exportClause) { // export * from "./x"
        if (mod) for (const [n, e] of moduleExports(w, mod)) if (n !== "default" && !out.has(n)) out.set(n, e);
      } else if (ts.isNamespaceExport(node.exportClause)) {
        out.set(node.exportClause.name.text, { file: mod ?? file, type: node.isTypeOnly });
      } else {
        for (const el of node.exportClause.elements) {
          const local = (el.propertyName ?? el.name).text;
          const src = mod ? [mod, local] : imports.get(local);
          // A name its source module doesn't export is not exported here either.
          const found = src ? moduleExports(w, src[0]).get(src[1]) : { file, type: false };
          if (found) out.set(el.name.text, { file: found.file, type: found.type || node.isTypeOnly || el.isTypeOnly });
        }
      }
    } else if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const isDefault = node.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      const names = ts.isVariableStatement(node) ? node.declarationList.declarations.map((d) => d.name.text) : [isDefault ? "default" : node.name?.text];
      const type = ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
      for (const n of names) out.set(n, { file, type });
    }
  }
  return out;
}

/**
 * Every package under `packages/`: name → Map(export name → { file, type }),
 * merged across the package's subpath entries.
 */
export function packageExports(read) {
  const w = { read, memo: new Map(), bare: new Map(), dirs: new Map() };
  const entries = new Map(); // package name → entry files
  for (const dir of read.packageDirs()) {
    const text = read(`packages/${dir}/package.json`);
    if (!text) continue;
    const { name, exports: map = {} } = JSON.parse(text);
    const files = [];
    w.dirs.set(name, dir);
    for (const [sub, v] of Object.entries(typeof map === "string" ? { ".": map } : map)) {
      const target = typeof v === "string" ? v : v.default ?? v.import;
      if (typeof target !== "string" || !target.includes("/src/")) continue;
      const add = (key, file) => { w.bare.set(key === "." ? name : `${name}/${key.slice(2)}`, file); files.push(file); };
      const pattern = normalize(join("packages", dir, target));
      if (!pattern.includes("*")) { add(sub, pattern); continue; }
      // "./items/*" → "./src/items/*.ts": one entry per file the pattern matches.
      const [head, tail] = pattern.split("*");
      for (const file of read.list(dirname(head))) {
        if (file.startsWith(head) && file.endsWith(tail) && file.length > head.length + tail.length) add(sub.replace("*", file.slice(head.length, file.length - tail.length)), file);
      }
    }
    entries.set(name, files);
  }
  const index = new Map();
  for (const [name, files] of entries) {
    const names = new Map();
    for (const file of files) for (const [n, e] of moduleExports(w, file)) if (!names.has(n)) names.set(n, e);
    index.set(name, names);
  }
  return index;
}
