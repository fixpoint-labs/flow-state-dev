/**
 * Renders ONE package's API reference section: TypeDoc, with typedoc-plugin-markdown, over the
 * `.d.ts` files the package publishes. Run by `generate.mjs` in its own process, one per
 * package, so packages render in parallel and one package's TypeScript program never shares
 * memory with another's.
 *
 *   node render-package.mjs '<json job>'
 *     job: { name, dir, entries: [{ subpath, types }], out, report }
 *
 * Writes the section's Markdown under `out` and a JSON report to `report`:
 * `{ name, exports, undocumented: ["<subpath> · <export>", ...] }`. Exits non-zero with a
 * message naming the package when it cannot read the package, so the build fails by name.
 *
 * Why the published `.d.ts` and not `src`: the reference is of what a reader installs. The
 * types are read through a throwaway tsconfig that lists only the entry files, with no
 * `paths`, so a workspace dependency resolves the way it does for an adopter: through its
 * package.json `types` to its built declarations.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Application, LogLevel, ReflectionKind } from "typedoc";

const job = JSON.parse(process.argv[2]);

function fail(reason) {
  process.stderr.write(`API reference: cannot read ${job.name}: ${reason}\n`);
  process.exit(1);
}

const entryFiles = job.entries.map((e) => join(job.dir, e.types));
if (entryFiles.length === 0) fail("its package.json publishes no `.d.ts` entry.");
for (const file of entryFiles) {
  if (!existsSync(file)) {
    fail(`${relative(job.dir, file)} does not exist. Build the packages' types first (pnpm packages:build).`);
  }
}

// The throwaway tsconfig lives beside the report, outside the package, so nothing the
// package's own tsconfig sets (paths to src, composite) changes what is read.
const tsconfig = join(dirname(job.report), "tsconfig.json");
mkdirSync(dirname(tsconfig), { recursive: true });
writeFileSync(
  tsconfig,
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "react-jsx",
      skipLibCheck: true,
      noEmit: true,
      types: [],
    },
    files: entryFiles,
  }),
);

rmSync(job.out, { recursive: true, force: true });

/** The root entry's module name: it renders as the section's index page. */
const ROOT_MODULE = "index";
/**
 * Module name → its page's title, the import a reader writes (`@flow-state-dev/engine/host`).
 * Written over each entry page's heading after rendering: with `entryModule`, the plugin
 * titles every entry page with the project's name.
 */
const titleByModule = new Map();

/** Errors TypeDoc logs; any one of them fails this package. */
const errors = [];

const app = await Application.bootstrapWithPlugins({
  name: job.name,
  entryPoints: entryFiles,
  entryPointStrategy: "resolve",
  tsconfig,
  out: job.out,
  plugin: ["typedoc-plugin-markdown"],
  readme: "none",
  // Declarations, not a program to check: a type error in a dependency is that package's
  // build to catch, and checking would cost every section a full type-check.
  skipErrorChecking: true,
  excludeInternal: true,
  excludePrivate: true,
  excludeProtected: true,
  disableSources: true,
  githubPages: false,
  logLevel: LogLevel.Warn,
  validation: { notExported: false, invalidLink: false, rewrittenLink: false, notDocumented: false },
  // typedoc-plugin-markdown: one page per entry point, so a section is a folder with one
  // page for the root and one per public subpath, never a page per export.
  outputFileStrategy: "modules",
  entryFileName: "index.md",
  // The root entry is the section's own page; each public subpath is a page beside it.
  entryModule: ROOT_MODULE,
  // One folder per section: nested folders break the plugin's links to the entry module.
  flattenOutputFiles: true,
  hidePageHeader: true,
  hideBreadcrumbs: true,
  // The site parses Markdown as MDX; braces and tags in a comment would otherwise be read as JSX.
  sanitizeComments: true,
  useCodeBlocks: true,
  // Each heading carries the anchor the plugin links to, so a page's links never depend on
  // the site numbering duplicate headings the way the plugin does.
  useCustomAnchors: true,
  customAnchorsFormat: "escapedCurlyBrace",
  // Members stay lists, the plugin's default: a table cell flattens a comment's code
  // examples onto one line, where nested backticks break.
});
app.logger.log = (message, level) => {
  if (level === LogLevel.Error) errors.push(String(message));
};

const project = await app.convert();
if (!project || errors.length > 0) {
  fail(errors.length > 0 ? errors.join("; ") : "TypeDoc converted nothing.");
}

// Name each entry point by the import a reader writes (`@flow-state-dev/engine/host`), not
// by its declaration file's path.
// TypeDoc keys a module by its source file when a declaration map leads there, so each
// entry is keyed by its `.d.ts` and by the source its map names.
const subpathByFile = new Map();
for (const e of job.entries) {
  const dts = join(job.dir, e.types);
  subpathByFile.set(dts, e.subpath);
  if (existsSync(`${dts}.map`)) {
    const { sources = [] } = JSON.parse(readFileSync(`${dts}.map`, "utf8"));
    for (const source of sources) subpathByFile.set(resolve(dirname(dts), source), e.subpath);
  }
}
const importName = (subpath) => (subpath === "." ? job.name : `${job.name}/${subpath}`);
const modules = project.children?.filter((c) => c.kindOf(ReflectionKind.Module)) ?? [];
const sections = [];
if (job.entries.length === 1) {
  sections.push({ subpath: ".", reflection: project });
} else {
  for (const mod of modules) {
    const fileName = project.getSymbolIdFromReflection(mod)?.fileName;
    const subpath = fileName ? subpathByFile.get(fileName) : undefined;
    if (!subpath) fail(`entry point "${mod.name}" (${fileName}) matches no published subpath.`);
    // A module's name is its page's file name, so it carries no slash (the plugin's relative
    // links break across one); its page title is the import a reader writes.
    mod.name = subpath === "." ? ROOT_MODULE : subpath.replaceAll("/", "-");
    titleByModule.set(mod.name, importName(subpath));
    sections.push({ subpath, reflection: mod });
  }
}
const root = sections.find((s) => s.subpath === ".");
if (!root || !(root.reflection.children?.length > 0)) fail("its root entry exports nothing TypeDoc can read.");

/** Whether a reflection carries a doc comment on itself or on any of its signatures. */
const documented = (r) =>
  r.hasComment() ||
  (r.signatures ?? []).some((s) => s.hasComment()) ||
  (r.getSignature?.hasComment() ?? false) ||
  (r.type?.declaration?.signatures ?? []).some((s) => s.hasComment());

let exportsCount = 0;
const undocumented = new Set();
for (const { subpath, reflection } of sections) {
  for (const child of reflection.children ?? []) {
    // A re-export of a name another entry already declares is listed under that entry.
    if (child.kindOf(ReflectionKind.Reference)) continue;
    exportsCount++;
    if (!documented(child)) undocumented.add(`${importName(subpath)} · ${child.name}`);
  }
}

await app.generateOutputs(project);
if (errors.length > 0) fail(errors.join("; "));

// A doc comment can link to an anchor in its own source file (`[the coordinate](#coordinate)`)
// that the generated page does not have, and the site build refuses a broken anchor. Such a
// link keeps its text and loses the link. The plugin's own links target a heading's anchor,
// which `useCustomAnchors` writes as `\{#id\}`.
const unlinked = [];
for (const file of readdirSync(job.out)) {
  if (!file.endsWith(".md")) continue;
  const path = join(job.out, file);
  let text = readFileSync(path, "utf8");
  const title = titleByModule.get(file.slice(0, -".md".length));
  if (title) text = text.replace(/^# .*$/m, `# ${title}`);
  const anchors = new Set([...text.matchAll(/\\\{#([^\\}]+)\\\}/g)].map((m) => m[1]));
  const next = text.replace(/\[([^\]]*)\]\(#([^)\s]+)\)/g, (link, label, anchor) => {
    if (anchors.has(anchor)) return link;
    unlinked.push(`${file} · #${anchor}`);
    return label;
  });
  writeFileSync(path, next);
}

writeFileSync(
  job.report,
  JSON.stringify({ name: job.name, exports: exportsCount, undocumented: [...undocumented], unlinked }, null, 2),
);
