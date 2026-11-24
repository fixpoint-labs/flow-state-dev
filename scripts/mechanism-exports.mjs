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
 * `read.tracked()` (every git-tracked path) and `read.grep(text, dirs)` (the tracked
 * files under `dirs` containing `text`) let the import census (`import-census.mjs`)
 * read the same tree the walk does.
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";

const gitIn = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
/** A NUL-terminated git listing (`-z`): git quotes a non-ASCII or tab-bearing path in a line listing, never here. */
const nulList = (out) => out.split("\0").filter(Boolean);
/** `git grep -l -F`, which exits 1 when nothing matches. Each path comes back after `prefix` (`<ref>:`). */
function grepFiles(root, refArgs, text, dirs, prefix) {
  try {
    return nulList(gitIn(root, ["grep", "-l", "-z", "-F", "-e", text, ...refArgs, "--", ...dirs])).map((f) => f.slice(prefix.length));
  } catch (err) {
    if (err.status === 1) return [];
    throw err;
  }
}

/**
 * Whether an `exports` target is a source module the walk can read: anything under `src/`, or
 * a TypeScript source file wherever it sits (shift-manager's `./cli/index.ts`), never emitted output.
 */
const isSourceTarget = (t) => t.includes("/src/") || (/\.[mc]?tsx?$/.test(t) && !/\.d\.[mc]?tsx?$/.test(t) && !/(^|\/)dist\//.test(t));

/** Read files from the working tree under `root`. */
export const fsReader = (root) => {
  const read = (path) => { try { return readFileSync(join(root, path), "utf8"); } catch { return null; } };
  read.packageDirs = () => readdirSync(join(root, "packages"));
  read.list = (dir) => { try { return readdirSync(join(root, dir), { recursive: true }).map((f) => join(dir, f)); } catch { return []; } };
  read.tracked = () => nulList(gitIn(root, ["ls-files", "-z"]));
  read.grep = (text, dirs) => grepFiles(root, [], text, dirs, "");
  return read;
};

/**
 * Read files under `root`, a tree that is not a git checkout (a `git archive` of a commit, as the
 * adopter goal's control reads): every file under it is "tracked" but `node_modules` and `.git`.
 */
export const dirReader = (root) => {
  const read = fsReader(root);
  let files;
  read.tracked = () => (files ??= readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path, e.name).slice(root.length).replace(/^[\\/]+/, ""))
    .filter((f) => !/(^|\/)(node_modules|\.git)\//.test(f)));
  read.grep = (text, dirs) => read.tracked().filter((f) => dirs.some((d) => f.startsWith(`${d}/`)) && (read(f) ?? "").includes(text));
  return read;
};

/**
 * `base`, with some files' text replaced or added (path → text): how the export check's plants
 * and the root-is-for-app-authors goal's control reach the real walk without touching the tree.
 */
export const overlayReader = (base, files) => {
  const read = (path) => (path in files ? files[path] : base(path));
  read.packageDirs = base.packageDirs;
  read.list = base.list;
  read.tracked = () => [...new Set([...base.tracked(), ...Object.keys(files)])];
  read.grep = (text, dirs) => {
    const under = (f) => dirs.some((d) => f.startsWith(`${d}/`));
    const planted = Object.keys(files).filter((f) => under(f) && files[f].includes(text));
    return [...new Set([...base.grep(text, dirs).filter((f) => !(f in files)), ...planted])];
  };
  return read;
};

/**
 * Read files as they were at git `ref`. A file is read with the rest of its directory two
 * levels down (`packages/core`, `apps/docs`) in one `git cat-file --batch`, not one
 * `git show` each, so a walk over a whole tree takes seconds.
 */
export const gitReader = (root, ref) => {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  const cache = new Map();
  const fetched = new Set();
  const fetch = (scope) => {
    fetched.add(scope);
    let listing;
    // NUL-terminated (`-z`): a line listing quotes a non-ASCII or tab-bearing path, which then matches no lookup.
    try { listing = git(["ls-tree", "-r", "-z", ref, "--", scope]).split("\0").filter(Boolean); } catch { return; }
    const blobs = listing.map((l) => /^\d+ blob ([0-9a-f]+)\t(.*)$/s.exec(l)).filter(Boolean);
    if (!blobs.length) return;
    const out = execFileSync("git", ["cat-file", "--batch"], { cwd: root, input: blobs.map((b) => b[1]).join("\n") + "\n", maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "ignore"] });
    let at = 0;
    for (const [, , path] of blobs) {
      const eol = out.indexOf(10, at);
      const size = Number(out.toString("utf8", at, eol).split(" ")[2]);
      cache.set(path, out.toString("utf8", eol + 1, eol + 1 + size));
      at = eol + 1 + size + 1;
    }
  };
  const read = (path) => {
    const parts = path.split("/");
    const scope = parts.length > 2 ? parts.slice(0, 2).join("/") : path;
    if (!fetched.has(scope)) fetch(scope);
    return cache.get(path) ?? null;
  };
  read.packageDirs = () => git(["ls-tree", "-z", "--name-only", `${ref}:packages`]).split("\0").filter(Boolean);
  read.list = (dir) => { try { return git(["ls-tree", "-r", "-z", "--name-only", ref, "--", `${dir}/`]).split("\0").filter(Boolean); } catch { return []; } };
  read.tracked = () => nulList(gitIn(root, ["ls-tree", "-r", "-z", "--name-only", ref]));
  read.grep = (text, dirs) => grepFiles(root, [ref], text, dirs, `${ref}:`);
  return read;
};

const EXT = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];
function resolveRelative(read, fromFile, spec) {
  const base = normalize(join(dirname(fromFile), spec)).replace(/\.(m?js|jsx)$/, "");
  for (const ext of EXT) if (/\.[mc]?tsx?$/.test(base + ext) && read(base + ext) != null) return base + ext;
  return null;
}

/** The file a module specifier in `file` loads, or null. `w` is { read, bare, dirs }. */
function resolveSpec(w, file, spec) {
  if (!spec) return null;
  if (spec.startsWith(".")) return resolveRelative(w.read, file, spec);
  if (w.bare.has(spec)) return w.bare.get(spec);
  // A deep import the exports map doesn't list (`@flow-state-dev/contracts/items/internal`)
  // resolves under that package's src/, as tsconfig.base.json's paths do.
  const [, name, sub] = /^(@[^/]+\/[^/]+)\/(.+)$/.exec(spec) ?? [];
  return w.dirs.has(name) ? resolveRelative(w.read, `packages/${w.dirs.get(name)}/src/x`, `./${sub}`) : null;
}

/**
 * name → { file, type, decl }: the declaring file, whether the name is type-only, and the name
 * it is declared under in that file (`impl` for `export { impl as used }`; unset for
 * `export * as ns`). `w` is { read, memo, bare, dirs }.
 */
function moduleExports(w, file) {
  if (w.memo.has(file)) return w.memo.get(file);
  const out = new Map();
  w.memo.set(file, out);
  const text = w.read(file);
  if (text == null) return out;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const imports = new Map(); // local name → [module file, imported name]
  const from = (node) => resolveSpec(w, file, node.moduleSpecifier?.text);
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
          const found = src ? moduleExports(w, src[0]).get(src[1]) : { file, type: false, decl: local };
          if (found) out.set(el.name.text, { file: found.file, type: found.type || node.isTypeOnly || el.isTypeOnly, decl: found.decl });
        }
      }
    } else if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const isDefault = node.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      const names = ts.isVariableStatement(node) ? node.declarationList.declarations.map((d) => d.name.text) : [isDefault ? "default" : node.name?.text];
      const type = ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
      for (const n of names) out.set(n, { file, type, decl: n });
    }
  }
  return out;
}

/**
 * Every package under `packages/`, entry by entry: package name → Map(subpath → Map(export
 * name → { file, type })). The subpath is the `exports` key as an importer writes it after the
 * package name: `"."` for the root, `"./types"`, and one key per file a wildcard entry matches
 * (`"./items/foo"`). The export check reads the `"."` entry; `packageExports` merges them.
 * `index.resolve(file, spec, name)` finds where a name `file` imports from `spec` is declared.
 */
export function packageEntryExports(read) {
  const w = { read, memo: new Map(), bare: new Map(), dirs: new Map() };
  const entries = new Map(); // package name → [subpath, entry file][]
  for (const dir of read.packageDirs()) {
    const text = read(`packages/${dir}/package.json`);
    if (!text) continue;
    const { name, exports: map = {} } = JSON.parse(text);
    const files = [];
    w.dirs.set(name, dir);
    for (const [sub, v] of Object.entries(typeof map === "string" ? { ".": map } : map)) {
      const target = typeof v === "string" ? v : v.default ?? v.import;
      if (typeof target !== "string" || !isSourceTarget(target)) continue;
      const add = (key, file) => { w.bare.set(key === "." ? name : `${name}/${key.slice(2)}`, file); files.push([key, file]); };
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
  // Walked only once every package's entries are known, so a cross-package re-export resolves.
  const index = new Map();
  for (const [name, files] of entries) {
    const byEntry = new Map();
    for (const [key, file] of files) byEntry.set(key, moduleExports(w, file));
    index.set(name, byEntry);
  }
  // Where a name `file` imports from `spec` is declared: { file, type, decl }, or null.
  index.resolve = (file, spec, name) => {
    const mod = resolveSpec(w, file, spec);
    return mod ? moduleExports(w, mod).get(name) ?? null : null;
  };
  return index;
}

/**
 * Every package under `packages/`: name → Map(export name → { file, type }),
 * merged across the package's subpath entries (the first entry to export a name wins).
 */
export function packageExports(read) {
  const index = new Map();
  for (const [name, byEntry] of packageEntryExports(read)) {
    const names = new Map();
    for (const exp of byEntry.values()) for (const [n, e] of exp) if (!names.has(n)) names.set(n, e);
    index.set(name, names);
  }
  return index;
}
