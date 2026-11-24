/**
 * The inventory rules every app on workforce is graded by, read off its files,
 * and the ratchet that holds each app to a checked-in allowlist that only
 * shrinks. Claude Code-style, Teammates and Shift Manager each call it from
 * their `pnpm test` with their own settings ({@link AppInventory}), and the
 * epic's closure goal (`goals/kits/an-app-is-config-ui-and-small-flows/`)
 * grades the same rules, so an app has one inventory, not two.
 *
 * - {@link findings} grades a folder: each finding keyed by file, symbol and
 *   kind, the allowlist's key. It reads no git, so a goal can grade an archive.
 * - {@link checkInventory} is the ratchet: the findings against the app's
 *   allowlist, and the allowlist and the read-model files against the
 *   merge-base. It fails closed when no base resolves; it never skips.
 *
 * The rules (the inventory's L1 to L4, H, and own sessions):
 *
 * - L1: every file is configuration, UI, a small flow, or outside the count,
 *   by its path alone.
 * - L2: at most three flows, each under 200 lines, and 300 lines of
 *   configuration in all.
 * - L3: no UI file reaches the server itself: no value imported from the
 *   client (the entry may import `createClient`), no `.subscribe(` and no
 *   `.flow(` call.
 * - L4: every exported object type is one the screen computes itself, named
 *   on the app's screen-type list; a row a view returns takes its type from
 *   the view.
 * - H: the host keeps no wiring a kit replaces.
 * - own sessions: no own-session helper in the app's source.
 *
 * The rules read most source with patterns, not a parser: a finding written
 * in an unusual form can pass. L3's calls are the exception: the TypeScript
 * compiler finds each `.subscribe(` and `.flow(` call and its holder, the
 * innermost function, method, class, or function bound to a const around it
 * (`(module)` outside them all), so a call moved out of an allowlisted
 * function can't keep that function's entry. Imports Node's built-ins and
 * `typescript` (the repo's own dev dependency: this runs only in tests and
 * goals); never a package export.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The repository's root, which the ratchet reads the merge-base from. */
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** A rule an app is held to. */
export type Rule = "L1" | "L2" | "L3" | "L4" | "H" | "own sessions";

/** A screen type that left the allowlist: why the screen computes it, which the closure lists for its reviewer. */
export interface ScreenType {
  name: string;
  reason: string;
}

/** One app's settings: where it is, which rules it meets, and what its screen computes itself. */
export interface AppInventory {
  /** The app's folder from the repository root, e.g. `labs/teammates`: where the merge-base is read. */
  path: string;
  /** The folder graded; the app's own checkout unless a control grades a copy. */
  root?: string;
  /** The entry, which builds the one client: it may import `createClient`, and L4 skips it. */
  entry: string;
  rules: readonly Rule[];
  /** Files that must not exist. */
  gone?: readonly string[];
  /** Folders L4 skips, e.g. `src/components/`. */
  typesSkip?: readonly string[];
  /**
   * The types the screen computes itself, by the module that exports them. A
   * type that was on the merge-base's allowlist needs a {@link ScreenType}
   * with its reason; a new one may be a bare name.
   */
  screenTypes: Readonly<Record<string, readonly (string | ScreenType)[]>>;
  /** Type names that can never be screen types: still a finding when listed. */
  neverScreen?: RegExp;
  /** What is left of the app's read model: files, or folders ending in `/`, that may not grow past their merge-base length; a new file in a folder fails. */
  readModel?: readonly string[];
  /** The allowlist, from the app's folder. Default `test/inventory-allowlist.json`. */
  allowlist?: string;
}

/** An allowlist entry, and a finding's key: compared as a multiset. */
export interface Key {
  file: string;
  symbol: string;
  kind: string;
}

/** One finding: its key, the rule, and what it says. */
export interface Finding extends Key {
  rule: Rule | "gone";
  detail: string;
}

/** ER-1's caps: at most this many flows, each under this many lines, and this many lines of configuration in all. */
const CAPS = { flows: 3, flowLines: 200, configLines: 300 } as const;

/**
 * The own-session helpers the epic retires, as an extended regular expression
 * both this module and the closure goal's `git grep -E` read; group 1 is the
 * name. Each name is split by a group, so the grep doesn't find this file.
 */
export const OWN_SESSION_PATTERN = String.raw`\b(own(Sessions?)|lab(Sessions?)|roster(Session)|reader(SessionId)|openReader(Session))\b`;
const OWN_SESSION = new RegExp(OWN_SESSION_PATTERN, "g");

/** What an install or a build writes. */
const BUILT = new Set(["node_modules", "dist", "dist-client"]);

const rootOf = (app: AppInventory) => app.root ?? join(REPO_ROOT, app.path);
const allowlistOf = (app: AppInventory) => app.allowlist ?? "test/inventory-allowlist.json";

/** Every file under `dir` of `root`, by its path from `root`, skipping what a build or install writes. */
export function filesUnder(dir: string, root: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const name of readdirSync(abs)) {
      if (BUILT.has(name) || name.startsWith(".")) continue;
      const path = join(abs, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path));
    }
  };
  if (existsSync(join(root, dir))) walk(join(root, dir));
  return out;
}

/** The kind of code a file of the app is, by its path alone (ER-1's classes, with the small flows in `flows/`). */
type Kind = "config" | "flow" | "ui" | "outside" | "other";

const OUTSIDE = [/^README\.md$/, /^package\.json$/, /^tsconfig\.json$/, /^vite\.config\.ts$/, /^index\.html$/, /^test\//,
  // Tooling ER-1 doesn't name, counted outside with it: no logic.
  /^components\.json$/, /^vitest(\.[a-z]+)?\.config\.ts$/, /^cli\/index\.ts$/];

function kindOf(rel: string): Kind {
  if (OUTSIDE.some((r) => r.test(rel))) return "outside";
  if (rel === "fsdev.config.mts" || rel === "host.mts" || /^workforce\/.*\.md$/.test(rel)) return "config";
  if (/^flows\/[^/]+\.mts$/.test(rel)) return "flow";
  if (/^src\/.*\.(tsx|ts|css)$/.test(rel)) return "ui";
  return "other";
}

const linesIn = (text: string) => (text.match(/\n/g) ?? []).length;
const isCode = (rel: string) => /\.(m?ts|tsx)$/.test(rel);
/** Code without what its comments say about it; a block comment keeps its line breaks, so a line number is the file's. */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, "")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const codeOf = (abs: string) => stripComments(readFileSync(abs, "utf8"));

/** A parsed file, and the innermost named holder of any position in it. */
interface Parsed {
  source: ts.SourceFile;
  /** The innermost function, method, class, or function bound to a const holding `pos`; `(module)` outside them all. */
  holderAt(pos: number): string;
  /** The 1-based line of `pos`. */
  lineOf(pos: number): number;
}

/** The name a node holds what's inside it under, or `undefined` when it holds nothing by name. */
function holderName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return node.name?.text ?? "default";
  if (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
    if (ts.isConstructorDeclaration(node)) return "constructor";
    return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name) ? node.name.text : undefined;
  }
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node)) && ts.isVariableDeclaration(node.parent) && node.parent.initializer === node) {
    const list = node.parent.parent;
    if (ts.isVariableDeclarationList(list) && list.flags & ts.NodeFlags.Const && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  }
  return undefined;
}

/**
 * Parses `text` with the TypeScript compiler, so a holder is its real lexical
 * scope: strings, template literals, regular expressions and JSX text can't
 * shift it, and a call after a function's end isn't that function's.
 */
function parse(text: string, rel: string): Parsed {
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const holders: { start: number; end: number; name: string }[] = [];
  const visit = (node: ts.Node) => {
    const name = holderName(node);
    if (name !== undefined) holders.push({ start: node.getStart(source), end: node.getEnd(), name });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return {
    source,
    // Holders are pushed outermost first, so the last one containing `pos` is the innermost.
    holderAt: (pos) => holders.filter((h) => h.start <= pos && pos < h.end).at(-1)?.name ?? "(module)",
    lineOf: (pos) => source.getLineAndCharacterOfPosition(pos).line + 1,
  };
}

/** The value imports `text` makes from `pkg`: each name not marked `type`, plus any namespace, default, dynamic or re-export form. */
function valueImports(text: string, pkg: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(import|export)\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
    if (m[2] !== undefined || m[4] !== pkg) continue;
    for (const raw of m[3]!.split(",")) {
      const name = raw.trim();
      if (name !== "" && !name.startsWith("type ")) out.push(m[1] === "export" ? `re-export ${name}` : name.split(/\s+as\s+/)[0]!);
    }
  }
  // Any other form can't be read name by name: name it as such.
  const escaped = pkg.replace(/[/.]/g, "\\$&");
  for (const m of text.matchAll(new RegExp(`(import\\s+\\*\\s+as\\s+\\w+|import\\s+\\w+|import\\(|export\\s+\\*)\\s*(from\\s*)?["']${escaped}["']`, "g"))) out.push(m[1]!);
  return out;
}

/** L1: every file is configuration, UI, a small flow, or outside the count. */
function unclassified(root: string): Finding[] {
  return filesUnder("", root)
    .filter((rel) => kindOf(rel) === "other")
    .map((rel) => ({ rule: "L1", file: rel, symbol: "(file)", kind: "unclassified", detail: `${rel}: not configuration, UI, a small flow or outside the count` }));
}

/** The configuration's files and their total lines, read through `read`. */
function configuration(files: readonly string[], read: (rel: string) => string): { total: number; each: string } {
  const config = files.filter((rel) => kindOf(rel) === "config");
  const sizes = config.map((rel) => [rel, linesIn(read(rel))] as const);
  return { total: sizes.reduce((n, [, size]) => n + size, 0), each: sizes.map(([rel, size]) => `${rel} ${size}`).join(", ") };
}

/** L2: the flows and the configuration within ER-1's caps. */
function overCaps(root: string): Finding[] {
  const files = filesUnder("", root);
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const flows = files.filter((rel) => kindOf(rel) === "flow");
  const found: Finding[] = [];
  if (flows.length > CAPS.flows) found.push({ rule: "L2", file: "flows/", symbol: "(count)", kind: "cap", detail: `${flows.length} flows, cap ${CAPS.flows}` });
  for (const rel of flows) {
    const size = linesIn(read(rel));
    if (size >= CAPS.flowLines) found.push({ rule: "L2", file: rel, symbol: "(lines)", kind: "cap", detail: `${rel}: ${size} lines, cap ${CAPS.flowLines - 1}` });
  }
  const config = configuration(files, read);
  if (config.total > CAPS.configLines) found.push({ rule: "L2", file: "configuration", symbol: "(lines)", kind: "cap", detail: `configuration ${config.total} lines, cap ${CAPS.configLines} (${config.each})` });
  return found;
}

/** L3: each value imported from the client, by its name, and each `.subscribe(` and `.flow(` call, by the declaration that holds it. */
function reachingTheServer(root: string, entry: string): Finding[] {
  return filesUnder("src", root).filter(isCode).flatMap((rel) => {
    const text = readFileSync(join(root, rel), "utf8");
    const imports: Finding[] = valueImports(stripComments(text), "@flow-state-dev/client")
      .filter((name) => !(rel === entry && name === "createClient"))
      .map((name) => ({ rule: "L3", file: rel, symbol: name, kind: "client import", detail: `${rel}: imports ${name} from the client` }));
    const parsed = parse(text, rel);
    const calls: Finding[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && /^(subscribe|flow)$/.test(node.expression.name.text)) {
        const method = node.expression.name.text;
        const pos = node.expression.name.getStart(parsed.source);
        const holder = parsed.holderAt(pos);
        calls.push({ rule: "L3", file: rel, symbol: holder, kind: `${method} call`, detail: `${rel}:${parsed.lineOf(pos)}: a .${method}( call in ${holder}` });
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed.source);
    return [...imports, ...calls];
  });
}

/** The names `app` lists as screen types in `rel`. */
const screenNames = (app: AppInventory, rel: string) => (app.screenTypes[rel] ?? []).map((entry) => (typeof entry === "string" ? entry : entry.name));

/** The object types a module's text exports, by name: a union of string literals names no row, so it isn't one. */
const exportedTypes = (text: string) =>
  [...text.matchAll(/^export\s+(?:interface\s+(\w+)\b[^=\n]*|type\s+(\w+)(?:<[^>]*>)?\s*=\s*(.*))$/gm)]
    .filter((m) => m[1] !== undefined || !/^("[^"]*"\s*\|?\s*)+;?$/.test(m[3]!.trim()))
    .map((m) => m[1] ?? m[2]!);

/** L4: exported object types in `src/`, the entry and `typesSkip` aside, that aren't the app's screen types. */
function unlistedTypes(app: AppInventory, root: string): Finding[] {
  const modules = filesUnder("src", root).filter((rel) => /\.tsx?$/.test(rel) && rel !== app.entry && !(app.typesSkip ?? []).some((dir) => rel.startsWith(dir)));
  return modules.flatMap((rel) =>
    exportedTypes(readFileSync(join(root, rel), "utf8"))
      .filter((name) => app.neverScreen?.test(name) || !screenNames(app, rel).includes(name))
      .map((name) => ({ rule: "L4", file: rel, symbol: name, kind: "type", detail: `${rel}: ${name}, a hand-written type the screen doesn't compute` })),
  );
}

// The two retired names are split in the pattern: FIX-2627's callers census counts every mention of them.
const WIRING = /workerFlows:\s*\(\)\s*=>|\b(createWorker(?:Installation)|hireWork(?:force))\(|\bas never\b/;

/**
 * H: the host wiring a kit replaces, in a host file: a `workerFlows: () =>`
 * callback, a call to workforce's retired installation or hire function, or
 * an `as never` cast. Each line, by its path from two folders up.
 */
export function hostWiring(hostFile: string): string[] {
  const at = relative(join(dirname(hostFile), "../.."), hostFile);
  return wiringLines(readFileSync(hostFile, "utf8")).map(({ index, line }) => `${at}:${index + 1}: ${line.trim()}`);
}

/** The lines of wiring in a host file's text, comments aside: each with its 0-based index. */
function wiringLines(text: string): { index: number; line: string }[] {
  return stripComments(text)
    .split("\n")
    .flatMap((line, index) => (WIRING.test(line) ? [{ index, line }] : []));
}

/** H, keyed: each line of wiring in `host.mts`, by the declaration that holds it. */
function hostFindings(root: string): Finding[] {
  const host = join(root, "host.mts");
  if (!existsSync(host)) return [];
  const text = readFileSync(host, "utf8");
  const parsed = parse(text, "host.mts");
  const starts = parsed.source.getLineStarts();
  return wiringLines(text).map(({ index, line }) => {
    const holder = parsed.holderAt(starts[index]! + (line.length - line.trimStart().length));
    return { rule: "H" as const, file: "host.mts", symbol: holder, kind: "host wiring", detail: `host.mts:${index + 1}: ${line.trim()}` };
  });
}

/** Own sessions: each own-session helper named in the app's source code, by its name. */
function sessionHelpers(root: string): Finding[] {
  return filesUnder("src", root).filter(isCode).flatMap((rel) =>
    codeOf(join(root, rel))
      .split("\n")
      .flatMap((line, i) =>
        [...line.matchAll(OWN_SESSION)].map((m) => ({ rule: "own sessions" as const, file: rel, symbol: m[1]!, kind: "own session", detail: `${rel}:${i + 1}: ${m[1]}, an own-session helper` })),
      ),
  );
}

/**
 * Every finding of the rules `app` is held to, on the folder it names (its
 * own checkout unless `root` points at a copy or an archive). Reads no git.
 */
export function findings(app: AppInventory): Finding[] {
  const root = rootOf(app);
  const has = (rule: Rule) => app.rules.includes(rule);
  return [
    ...(app.gone ?? []).filter((rel) => existsSync(join(root, rel))).map((rel): Finding => ({ rule: "gone", file: rel, symbol: "(file)", kind: "gone", detail: `${rel}: still there` })),
    ...(has("L1") ? unclassified(root) : []),
    ...(has("L2") ? overCaps(root) : []),
    ...(has("L3") ? reachingTheServer(root, app.entry) : []),
    ...(has("L4") ? unlistedTypes(app, root) : []),
    ...(has("H") ? hostFindings(root) : []),
    ...(has("own sessions") ? sessionHelpers(root) : []),
  ];
}

const keyOf = (k: Key) => `${k.file} · ${k.symbol} · ${k.kind}`;

/** The keys in `a` that `b` doesn't cover, counting repeats: a multiset difference. */
function minus<T extends Key>(a: readonly T[], b: readonly Key[]): T[] {
  const left = new Map<string, number>();
  for (const k of b) left.set(keyOf(k), (left.get(keyOf(k)) ?? 0) + 1);
  return a.filter((k) => {
    const n = left.get(keyOf(k)) ?? 0;
    if (n === 0) return true;
    left.set(keyOf(k), n - 1);
    return false;
  });
}

function parseAllowlist(text: string, where: string): Key[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every((e) => typeof e?.file === "string" && typeof e?.symbol === "string" && typeof e?.kind === "string")) {
    throw new Error(`${where}: an allowlist is an array of { file, symbol, kind }`);
  }
  return parsed.map(({ file, symbol, kind }: Key) => ({ file, symbol, kind }));
}

/** git in the C locale: {@link atBase} reads git's stderr, which git translates under any other. */
const GIT_ENV = { ...process.env, LC_ALL: "C" };

const git = (args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, env: GIT_ENV, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });

/** What git says, in the C locale, when the path is not in that commit: the only failure that means "not there". */
const NOT_AT_REV = /does not exist in|exists on disk, but not in/;

/**
 * A file's text at `rev`, or `undefined` when the commit doesn't have it. Any
 * other failure (a bad revision, git itself failing) throws: it must not read
 * as an absent file, which the ratchet takes as a new or trivially-subset one.
 */
export function atBase(rev: string, path: string): string | undefined {
  try {
    return execFileSync("git", ["show", `${rev}:${path}`], { cwd: REPO_ROOT, env: GIT_ENV, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const { status, stderr } = error as { status?: unknown; stderr?: unknown };
    if (status === 128 && NOT_AT_REV.test(String(stderr ?? ""))) return undefined;
    throw error;
  }
}

let warned = false;

/**
 * The merge-base the ratchet compares with, as a commit sha, or why none
 * resolves. CI passes it in (`INVENTORY_BASE`) for its event, and the test
 * never guesses it there. A local run with none passed uses the merge-base
 * with `origin/main`, which a stale `origin/main` makes older: a local PASS
 * is not CI's answer.
 */
function resolveBase(explicit: string | undefined): { sha: string } | { problem: string } {
  let ref = explicit ?? process.env.INVENTORY_BASE;
  if (ref === undefined || ref === "") {
    if (process.env.CI) return { problem: "no merge-base: CI passes INVENTORY_BASE for its event, and none was passed" };
    try {
      ref = git(["merge-base", "HEAD", "origin/main"]).trim();
    } catch {
      return { problem: "no merge-base: no INVENTORY_BASE, and no merge-base of HEAD with origin/main" };
    }
    if (!warned) console.warn(`inventory: compared with the merge-base of HEAD and origin/main (${ref.slice(0, 10)}); a local PASS is not CI's answer`);
    warned = true;
  }
  try {
    return { sha: git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim() };
  } catch {
    return { problem: `no merge-base: ${ref} names no commit here` };
  }
}

/**
 * The ratchet: what fails `app` against its allowlist and the merge-base,
 * each naming its file; an empty list is a pass. It fails on a finding not on
 * the allowlist, an entry whose finding is gone, an entry the merge-base's
 * allowlist doesn't have, a type moved from the merge-base's allowlist to
 * the screen-type list with no reason, a read-model file past its
 * merge-base length or new in a read-model folder, and (while the
 * configuration is over its cap) a configuration total past the
 * merge-base's. With no base, it fails closed.
 */
export function checkInventory(app: AppInventory, options: { base?: string } = {}): string[] {
  const root = rootOf(app);
  const base = resolveBase(options.base);
  if ("problem" in base) return [`${app.path}: ${base.problem}`];
  const listPath = allowlistOf(app);
  const allowlist = existsSync(join(root, listPath)) ? parseAllowlist(readFileSync(join(root, listPath), "utf8"), listPath) : [];
  const baseText = atBase(base.sha, `${app.path}/${listPath}`);
  // An allowlist absent at the base (the PR that seeds it) is a subset trivially.
  const baseList = baseText === undefined ? [] : parseAllowlist(baseText, `${listPath} at ${base.sha.slice(0, 10)}`);
  const found = findings(app);
  const failures = [
    ...minus(found, allowlist).map((f) => `${f.detail} (${f.rule}: not on the allowlist)`),
    ...minus(allowlist, found).map((k) => `${keyOf(k)}: on the allowlist, but the finding is gone: delete the entry`),
    ...(baseText === undefined ? [] : minus(allowlist, baseList).map((k) => `${keyOf(k)}: not on the merge-base's allowlist, which may only shrink`)),
  ];
  // A type left the allowlist when a base entry of its name is gone from the current one, whatever
  // file the base keyed it by: a type moved with its file is still the one the base listed.
  const leftTypes = new Set(minus(baseList, allowlist).filter((k) => k.kind === "type").map((k) => k.symbol));
  // A screen type the base already had moved nowhere. The base's screen-type list is code git can't
  // run, so it is read as the ratchet left it: the base's file exports the type and its allowlist
  // doesn't name it, which the base's own run passed only with the type on that list.
  const screenAtBase = (rel: string, name: string) =>
    !baseList.some((k) => k.kind === "type" && k.file === rel && k.symbol === name) && exportedTypes(atBase(base.sha, `${app.path}/${rel}`) ?? "").includes(name);
  for (const [rel, entries] of Object.entries(app.screenTypes)) {
    for (const entry of entries) {
      const name = typeof entry === "string" ? entry : entry.name;
      if (app.neverScreen?.test(name)) failures.push(`${rel}: ${name} can never be a screen type`);
      else if ((typeof entry === "string" || entry.reason.trim() === "") && leftTypes.has(name) && !screenAtBase(rel, name)) {
        failures.push(`${rel}: ${name} moved from the merge-base's allowlist to the screen-type list with no reason`);
      }
    }
  }
  const headFiles = filesUnder("", root);
  for (const spec of app.readModel ?? []) {
    for (const rel of headFiles.filter((r) => (spec.endsWith("/") ? r.startsWith(spec) : r === spec))) {
      const before = atBase(base.sha, `${app.path}/${rel}`);
      const now = linesIn(readFileSync(join(root, rel), "utf8"));
      if (before === undefined) failures.push(`${rel}: a new file in the read model (${spec}), ${now} lines`);
      else if (now > linesIn(before)) failures.push(`${rel}: ${now} lines, past its merge-base length of ${linesIn(before)}`);
    }
  }
  if (app.rules.includes("L2")) {
    const now = configuration(headFiles, (rel) => readFileSync(join(root, rel), "utf8")).total;
    if (now > CAPS.configLines) {
      let baseFiles: string[] = [];
      try {
        baseFiles = git(["ls-tree", "-r", "-z", "--name-only", base.sha, "--", `${app.path}/`]).split("\0").filter(Boolean).map((p) => p.slice(app.path.length + 1));
      } catch {
        // No folder at the base: nothing to compare with but the cap, which the allowlist already holds.
      }
      const before = configuration(baseFiles, (rel) => atBase(base.sha, `${app.path}/${rel}`) ?? "").total;
      if (baseFiles.length > 0 && now > before) failures.push(`configuration: ${now} lines, past its merge-base total of ${before}, while over its cap of ${CAPS.configLines}`);
    }
  }
  return failures;
}

/**
 * A copy of `app`'s folder in a temporary directory, without what an install
 * or a build writes, and the settings that grade it: what a control plants
 * into, so it never touches the app's own files. The merge-base is still read
 * at the app's own path.
 */
export function copyOf(app: AppInventory): AppInventory {
  const root = mkdtempSync(join(tmpdir(), "inventory-"));
  const source = rootOf(app);
  // Skips what `filesUnder` skips: a dot-folder such as `.fsdev` (a lab's store and run worktrees, gigabytes) is never graded, so copying it only costs time.
  cpSync(source, root, { recursive: true, filter: (from) => { const name = from.split(/[\\/]/).pop()!; return from === source || (!BUILT.has(name) && !name.startsWith(".")); } });
  return { ...app, root };
}
