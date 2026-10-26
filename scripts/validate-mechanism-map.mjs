#!/usr/bin/env node
/**
 * Check `docs/mechanisms/map.yaml` against package exports, and check an
 * opt-in ```mechanisms fence. Rules and known gaps: `docs/mechanisms/README.md`.
 * Not part of `pnpm typecheck`. Run `pnpm mechanism-map`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const RELATIONS = new Set([
  "near-duplicate",
  "distinct-jobs",
  "adapters",
  "legacy",
  "missing-abstraction",
]);

const STATUSES = new Set(["canonical", "deprecated", "candidate-to-merge"]);

/**
 * Public factories whose names do not match the `define*` / `create*`
 * patterns. A new factory with a novel name is a gap until it is added
 * here or renamed to the pattern. Keep this list short and specific.
 */
const BARE = new Set([
  "handler",
  "generator",
  "evaluator",
  "sequencer",
  "router",
  "dispatcher",
  "utility",
  "taskBoard",
  "goalSeekLoop",
  "hireWorkforce",
  "planAndExecute",
  "parallelTasks",
  "supervisor",
  "routedSpecialists",
  "eventActors",
  "responseAuditor",
  "roundRobin",
  "debate",
  "actor",
  "system",
  "claudeCodeAgent",
  "codexAgent",
  "cursorAgent",
  "harnessManager",
  "localWorkspaceHost",
  "serve",
  "runAction",
  "createFlowState",
  "createFlowApiRouter",
  "createModelResolver",
  "createSkillsLibrary",
  "createWorkerInstallation",
  "fifoDispatcher",
  "priorityDispatcher",
  "topologicalDispatcher",
  "testBlock",
  "testFlow",
  "testSequencer",
  "testRouter",
  "mockGenerator",
  "bullmqWorker",
]);

/** @param {string} name */
export function isPrimitiveName(name) {
  if (BARE.has(name)) return true;
  if (/^define[A-Z]/.test(name)) return true;
  if (/^create[A-Z]\w*(Capability|Adapter|Runtime|Stores|Handler|Client)$/.test(name)) return true;
  if (/^[a-z]\w*Stores$/.test(name)) return true;
  return false;
}

/** A covered file must name these. Schemas and types are not mechanisms. */
function isCoveredShape(name) {
  return /^[a-z]/.test(name) && !/Schema$/.test(name);
}

// --- YAML subset -----------------------------------------------------------
// The subset the map is written in: indent, lists, `|` blocks, comments,
// double quotes, `[]`. No anchors, no inline objects, no folded scalars.

/**
 * @param {string} text
 * @returns {unknown}
 */
export function parseYaml(text) {
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  /** @type {{ n: number, indent: number, text: string }[]} */
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const indent = line.match(/^ */)[0].length;
    if (indent % 2 !== 0) {
      throw new Error(`map.yaml:${i + 1}: indent must be a multiple of 2`);
    }
    lines.push({ n: i + 1, indent, text: stripComment(line.slice(indent)) });
  }

  function stripComment(s) {
    let quote = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') quote = !quote;
      if (c === "#" && !quote && (i === 0 || s[i - 1] === " ")) return s.slice(0, i).trimEnd();
    }
    return s.trimEnd();
  }

  let cursor = 0;

  function parseBlock(indent) {
    if (cursor >= lines.length || lines[cursor].indent < indent) return null;
    if (lines[cursor].indent > indent) {
      throw new Error(`map.yaml:${lines[cursor].n}: unexpected indent`);
    }
    if (lines[cursor].text.startsWith("- ") || lines[cursor].text === "-") {
      return parseList(indent);
    }
    return parseMap(indent);
  }

  function parseList(indent) {
    const out = [];
    while (cursor < lines.length && lines[cursor].indent === indent && (lines[cursor].text.startsWith("- ") || lines[cursor].text === "-")) {
      const line = lines[cursor];
      const rest = line.text === "-" ? "" : line.text.slice(2);
      cursor++;
      if (rest === "|") {
        out.push(readBlock(line.n, indent + 2));
        continue;
      }
      if (rest === "") {
        out.push(parseBlock(indent + 2));
        continue;
      }
      if (/^[^:]+:\s*(\||)$/.test(rest) || /^[^"\s][^:]*:\s+\S/.test(rest) || /^"[^"]+"\s*:/.test(rest)) {
        cursor--;
        // Re-read this line as a one-key map at the dash, then nested keys.
        const keyLine = { ...line, text: rest, indent: indent + 2 };
        const saved = lines[cursor];
        lines[cursor] = keyLine;
        // Nested keys keep their file indent, which is indent + 2.
        const value = parseMap(indent + 2);
        if (lines[cursor] === keyLine) lines[cursor] = saved;
        out.push(value);
        continue;
      }
      out.push(parseScalar(rest, line.n));
    }
    return out;
  }

  function parseMap(indent) {
    /** @type {Record<string, unknown>} */
    const out = {};
    while (cursor < lines.length && lines[cursor].indent === indent && !lines[cursor].text.startsWith("- ")) {
      const line = lines[cursor];
      const m = line.text.match(/^("(?:\\.|[^"])*"|[^:]+)\s*:\s*(.*)$/);
      if (!m) throw new Error(`map.yaml:${line.n}: expected key: value`);
      const key = m[1].startsWith('"') ? JSON.parse(m[1]) : m[1].trim();
      const rest = m[2];
      cursor++;
      if (rest === "|") out[key] = readBlock(line.n, indent + 2);
      else if (rest === "") out[key] = parseBlock(indent + 2);
      else out[key] = parseScalar(rest, line.n);
    }
    return out;
  }

  function readBlock(fromLine, indent) {
    const src = text.replace(/\r\n/g, "\n").split("\n");
    // Continue from the line after `fromLine` (1-based).
    const chunks = [];
    let i = fromLine; // next line index (0-based is fromLine, since n = i+1, next is index n)
    // src index of the line AFTER the `|` line is `fromLine` (1-based n of `|` line, next index = n).
    for (; i < src.length; i++) {
      const line = src[i];
      if (/^\s*$/.test(line)) {
        chunks.push("");
        continue;
      }
      const ind = line.match(/^ */)[0].length;
      if (ind < indent) break;
      chunks.push(line.slice(indent));
    }
    while (chunks.length && chunks[chunks.length - 1] === "") chunks.pop();
    // Advance cursor past consumed lines.
    while (cursor < lines.length && lines[cursor].n <= i) cursor++;
    return chunks.join("\n");
  }

  function parseScalar(raw, n) {
    const s = raw.trim();
    if (s === "[]") return [];
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null" || s === "~") return null;
    if (/^-?\d+$/.test(s)) return Number(s);
    if (s.startsWith('"') && s.endsWith('"')) {
      try {
        return JSON.parse(s);
      } catch {
        throw new Error(`map.yaml:${n}: bad string`);
      }
    }
    if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
    return s;
  }

  const value = parseBlock(0);
  if (cursor < lines.length) {
    throw new Error(`map.yaml:${lines[cursor].n}: leftover`);
  }
  return value;
}

// --- exports ---------------------------------------------------------------

function stripSourceComments(src) {
  let out = "";
  let i = 0;
  let state = "code";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && n === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "`") state = "tpl";
      out += c;
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += c;
      }
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        state = "code";
        i += 2;
        out += " ";
        continue;
      }
      if (c === "\n") out += c;
      i++;
      continue;
    }
    out += c;
    if (state === "sq" && c === "'" && src[i - 1] !== "\\") state = "code";
    if (state === "dq" && c === '"' && src[i - 1] !== "\\") state = "code";
    if (state === "tpl" && c === "`" && src[i - 1] !== "\\") state = "code";
    i++;
  }
  return out;
}

/**
 * @param {string} inner
 * @returns {{ exported: string, local: string, typeOnly: boolean }[]}
 */
function parseSpecifierList(inner) {
  return inner
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("//"))
    .map((part) => {
      const typeOnly = /^type\s+/.test(part);
      const rest = part.replace(/^type\s+/, "");
      const bits = rest.split(/\s+as\s+/);
      const local = bits[0].trim();
      const exported = (bits[1] ?? bits[0]).trim();
      return { local, exported, typeOnly };
    })
    .filter((spec) => /^[A-Za-z_$][\w$]*$/.test(spec.exported));
}

/**
 * @param {string} file
 * @param {Map<string, { values: Set<string>, types: Set<string> }>} cache
 * @param {(fromFile: string, spec: string) => string | null} resolveSpec
 */
export function collectExports(file, cache, resolveSpec) {
  const key = resolve(file);
  if (cache.has(key)) return cache.get(key);
  const empty = { values: new Set(), types: new Set() };
  if (!existsSync(key) || !statSync(key).isFile()) {
    cache.set(key, empty);
    return empty;
  }
  // Placeholder first, so a cycle does not recurse forever.
  cache.set(key, empty);
  const text = stripSourceComments(readFileSync(key, "utf8"));
  const values = new Set();
  const types = new Set();

  const reExport = /export\s+(type\s+)?(\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = reExport.exec(text))) {
    const typeOnly = Boolean(match[1]);
    const clause = match[2];
    const target = resolveSpec(key, match[3]);
    if (!target) continue;
    if (clause === "*") {
      const inner = collectExports(target, cache, resolveSpec);
      for (const name of inner.values) (typeOnly ? types : values).add(name);
      for (const name of inner.types) types.add(name);
      continue;
    }
    const inner = collectExports(target, cache, resolveSpec);
    for (const spec of parseSpecifierList(clause.slice(1, -1))) {
      const asType = typeOnly || spec.typeOnly || inner.types.has(spec.local);
      const asValue = !typeOnly && !spec.typeOnly && (inner.values.has(spec.local) || !inner.types.has(spec.local));
      if (asType && !asValue) types.add(spec.exported);
      else values.add(spec.exported);
    }
  }

  const starAs = /export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["']/g;
  while ((match = starAs.exec(text))) values.add(match[1]);

  const decl = /export\s+(type\s+|default\s+)?(?:async\s+)?(function\*?|const|class|enum|interface|type)\s+([A-Za-z_$][\w$]*)/g;
  while ((match = decl.exec(text))) {
    const typeKw = match[1] ?? "";
    const kind = match[2];
    const name = match[3];
    if (!name || name === "from") continue;
    if (typeKw.startsWith("type") || kind === "interface" || kind === "type") types.add(name);
    else values.add(name);
  }

  const local = /export\s+(type\s+)?\{([\s\S]*?)\}(?!\s*from)/g;
  while ((match = local.exec(text))) {
    const typeOnly = Boolean(match[1]);
    for (const spec of parseSpecifierList(match[2])) {
      if (typeOnly || spec.typeOnly) types.add(spec.exported);
      else if (types.has(spec.local) && !values.has(spec.local)) types.add(spec.exported);
      else values.add(spec.exported);
    }
  }

  const result = { values, types };
  cache.set(key, result);
  return result;
}

function resolveFile(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts"), join(base, "index.tsx")];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * @param {string} root
 */
export function loadPackages(root) {
  /** @type {Map<string, { dir: string, exports: Record<string, string> }>} */
  const packages = new Map();
  const packagesDir = join(root, "packages");
  for (const dir of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.exports || typeof manifest.exports !== "object" || Array.isArray(manifest.exports)) continue;
    /** @type {Record<string, string>} */
    const exportsMap = {};
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      const file = exportTargetFile(join(packagesDir, dir), target);
      if (file) exportsMap[subpath] = file;
    }
    packages.set(manifest.name, { dir: join(packagesDir, dir), exports: exportsMap });
  }
  return packages;
}

function exportTargetFile(pkgDir, target) {
  if (target && typeof target === "object") {
    target = target.default || target.import || target.require || null;
  }
  if (typeof target !== "string") return null;
  if (target.includes("*")) return null;
  if (/\.(css|json|md)$/.test(target)) return null;
  return resolveFile(resolve(pkgDir, target));
}

function makeResolver(packages) {
  /** @type {Map<string, { values: Set<string>, types: Set<string> }>} */
  const cache = new Map();
  /** @param {string} fromFile @param {string} spec */
  function resolveSpec(fromFile, spec) {
    if (spec.startsWith(".")) return resolveFile(resolve(dirname(fromFile), spec));
    const slash = spec.startsWith("@") ? spec.indexOf("/", spec.indexOf("/") + 1) : spec.indexOf("/");
    const name = slash === -1 ? spec : spec.slice(0, slash);
    const sub = slash === -1 ? "." : `.${spec.slice(slash)}`;
    const pkg = packages.get(name);
    if (!pkg) return null;
    return pkg.exports[sub] ?? null;
  }
  return {
    cache,
    resolveSpec,
    /** @param {string} file */
    of(file) {
      return collectExports(file, cache, resolveSpec);
    },
  };
}

// --- check -----------------------------------------------------------------

function asList(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  return value;
}

function entryNames(entry) {
  const names = new Set();
  for (const point of entry.entryPoints ?? []) {
    for (const name of point.exports ?? []) names.add(name);
  }
  for (const facet of entry.facets ?? []) {
    if (facet.symbol) names.add(facet.symbol);
  }
  for (const dep of entry.deprecatedExports ?? []) names.add(dep.name);
  return names;
}

/**
 * @param {unknown} map
 * @param {{ root: string, packages: Map<string, { dir: string, exports: Record<string, string> }>, resolver: ReturnType<typeof makeResolver> }} ctx
 */
export function checkMap(map, ctx) {
  /** @type {{ level: "error" | "warn" | "note", code: string, message: string }[]} */
  const findings = [];
  const fail = (code, message) => findings.push({ level: "error", code, message });
  const warn = (code, message) => findings.push({ level: "warn", code, message });
  const note = (code, message) => findings.push({ level: "note", code, message });

  if (!map || typeof map !== "object" || Array.isArray(map)) {
    fail("map-shape", "the map root must be a mapping");
    return findings;
  }
  const entries = asList(map.entries);
  if (!entries) {
    fail("map-shape", "`entries` must be a list");
    return findings;
  }

  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
      fail("entry-id", "an entry is missing a string id");
      continue;
    }
    if (byId.has(entry.id)) fail("entry-id", `duplicate id ${entry.id}`);
    byId.set(entry.id, entry);
    if (typeof entry.title !== "string" || !entry.title.trim()) fail("entry-title", `${entry.id}: title is required`);
    if (typeof entry.summary !== "string" || entry.summary.trim().length < 20) {
      fail("entry-summary", `${entry.id}: summary must be a sentence or two`);
    }
    if (!STATUSES.has(entry.status)) fail("entry-status", `${entry.id}: status must be canonical, deprecated, or candidate-to-merge`);
    if (entry.status && entry.status !== "canonical") {
      if (typeof entry.mergeInto !== "string") fail("merge-into", `${entry.id}: ${entry.status} requires mergeInto`);
    }
  }

  const facetOwner = new Map();
  for (const entry of byId.values()) {
    for (const facet of asList(entry.facets) ?? []) {
      if (!facet || typeof facet.id !== "string") {
        fail("facet-id", `${entry.id}: a facet is missing an id`);
        continue;
      }
      const qualified = `${entry.id}.${facet.id}`;
      if (byId.has(facet.id)) fail("facet-id", `${qualified}: facet id collides with an entry id`);
      if (!facetOwner.has(facet.id)) facetOwner.set(facet.id, []);
      facetOwner.get(facet.id).push(qualified);
      if (typeof facet.summary !== "string" || !facet.summary.trim()) {
        fail("facet-summary", `${qualified}: summary is required`);
      }
    }
  }

  function knownId(id) {
    if (byId.has(id)) return true;
    if (id.includes(".")) {
      const [parent, facet] = id.split(".");
      const entry = byId.get(parent);
      return Boolean(entry && (entry.facets ?? []).some((item) => item.id === facet));
    }
    const owners = facetOwner.get(id);
    return owners && owners.length === 1;
  }

  for (const entry of byId.values()) {
    if (entry.mergeInto && !knownId(entry.mergeInto)) {
      fail("merge-into", `${entry.id}: mergeInto ${entry.mergeInto} is not an entry or facet`);
    }
    const builtOn = asList(entry.builtOn);
    if (builtOn === null) fail("built-on", `${entry.id}: builtOn must be a list`);
    for (const id of builtOn ?? []) {
      if (typeof id !== "string" || !knownId(id)) fail("built-on", `${entry.id}: builtOn ${id} is not an entry or facet`);
      if (id === entry.id) fail("built-on", `${entry.id}: builtOn itself`);
    }
    const overlaps = asList(entry.overlaps);
    if (overlaps === null) fail("overlap", `${entry.id}: overlaps must be a list`);
    for (const overlap of overlaps ?? []) {
      if (!overlap || typeof overlap.id !== "string" || !knownId(overlap.id)) {
        fail("overlap", `${entry.id}: overlap target ${overlap && overlap.id} is not an entry or facet`);
        continue;
      }
      if (!RELATIONS.has(overlap.relation)) {
        fail("overlap", `${entry.id}: overlap ${overlap.id} relation must be one of ${[...RELATIONS].join(", ")}`);
      }
      if (typeof overlap.note !== "string" || overlap.note.trim().length < 20) {
        fail("overlap", `${entry.id}: overlap ${overlap.id} needs a note that says what the relationship is`);
      }
    }
    for (const point of asList(entry.entryPoints) ?? []) {
      if (!point || typeof point.path !== "string") {
        fail("entry-point", `${entry.id}: an entry point is missing a path`);
        continue;
      }
      const abs = join(ctx.root, point.path);
      if (!existsSync(abs)) {
        fail("entry-point", `${entry.id}: ${point.path} does not exist`);
        continue;
      }
      const exported = ctx.resolver.of(abs);
      for (const name of asList(point.exports) ?? []) {
        if (!exported.values.has(name) && !exported.types.has(name)) {
          fail("export-missing", `${entry.id}: ${point.path} does not export ${name}`);
        }
      }
    }
    for (const facet of asList(entry.facets) ?? []) {
      if (!facet?.path || !facet?.symbol) continue;
      const abs = join(ctx.root, facet.path);
      if (!existsSync(abs)) {
        fail("facet-symbol", `${entry.id}.${facet.id}: ${facet.path} does not exist`);
        continue;
      }
      const source = readFileSync(abs, "utf8");
      const needle = new RegExp(`(?:^|[^A-Za-z0-9_])${facet.symbol}\\s*[<(]`);
      if (!needle.test(source)) {
        fail("facet-symbol", `${entry.id}.${facet.id}: ${facet.symbol} is not a function or method in ${facet.path}`);
      }
    }
    for (const dep of asList(entry.deprecatedExports) ?? []) {
      if (!dep || typeof dep.name !== "string" || typeof dep.path !== "string") {
        fail("deprecated", `${entry.id}: deprecatedExports need name and path`);
        continue;
      }
      const abs = join(ctx.root, dep.path);
      if (!existsSync(abs)) {
        fail("deprecated", `${entry.id}: ${dep.path} does not exist`);
        continue;
      }
      const exported = ctx.resolver.of(abs);
      if (!exported.values.has(dep.name) && !exported.types.has(dep.name)) {
        fail("deprecated", `${entry.id}: ${dep.path} does not export ${dep.name}`);
      } else {
        note("deprecated", `${entry.id}: ${dep.name} is still exported (${dep.note ?? "no note"})`);
      }
    }
    for (const doc of asList(entry.docs) ?? []) {
      if (typeof doc !== "string" || !existsSync(join(ctx.root, doc))) fail("doc-path", `${entry.id}: docs path ${doc} does not exist`);
    }
    for (const consumer of asList(entry.reliedOnBy) ?? []) {
      if (typeof consumer === "string" && consumer.includes("/") && !existsSync(join(ctx.root, consumer))) {
        fail("relied-on", `${entry.id}: reliedOnBy ${consumer} does not exist`);
      }
    }
    for (const covered of asList(entry.covers) ?? []) {
      const abs = join(ctx.root, covered);
      if (!existsSync(abs)) {
        fail("covers", `${entry.id}: covers ${covered} does not exist`);
        continue;
      }
      const exported = ctx.resolver.of(abs);
      const claimed = entryNames(entry);
      for (const name of exported.values) {
        if (isCoveredShape(name) && !claimed.has(name)) {
          fail("covers", `${entry.id}: ${covered} exports ${name}, which the entry does not name`);
        }
      }
    }
    for (const sub of asList(entry.subpaths) ?? []) {
      if (!sub || typeof sub.package !== "string" || typeof sub.subpath !== "string") {
        fail("subpath", `${entry.id}: subpaths need package and subpath`);
      }
    }
  }

  /** @type {Set<string>} */
  const claimed = new Set();
  const claim = (pkg, subpath) => claimed.add(`${pkg} ${subpath}`);
  for (const entry of byId.values()) {
    for (const sub of asList(entry.subpaths) ?? []) {
      if (!sub?.package || !sub?.subpath) continue;
      const pkg = ctx.packages.get(sub.package);
      if (!pkg || !(sub.subpath in pkg.exports)) {
        fail("subpath", `${entry.id}: ${sub.package} ${sub.subpath} is not a concrete export`);
      } else claim(sub.package, sub.subpath);
    }
  }
  for (const sub of asList(map.sharedSubpaths) ?? []) {
    if (!sub || typeof sub.package !== "string" || typeof sub.subpath !== "string" || typeof sub.reason !== "string" || sub.reason.trim().length < 15) {
      fail("subpath", "sharedSubpaths need package, subpath, and a reason");
      continue;
    }
    const pkg = ctx.packages.get(sub.package);
    if (!pkg || !(sub.subpath in pkg.exports)) fail("subpath", `shared ${sub.package} ${sub.subpath} is not a concrete export`);
    else claim(sub.package, sub.subpath);
  }

  for (const [name, pkg] of ctx.packages) {
    const manifest = JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf8"));
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const targetText = typeof target === "string" ? target : JSON.stringify(target);
      if (subpath.includes("*") || (typeof target === "string" && target.includes("*"))) {
        warn("subpath-wildcard", `${name} ${subpath} is a wildcard export and is not covered`);
        continue;
      }
      if (/\.(css|json|md)/.test(targetText)) {
        warn("subpath-asset", `${name} ${subpath} is not code and is not covered`);
        continue;
      }
      if (!pkg.exports[subpath]) {
        fail("subpath", `${name} ${subpath} did not resolve to a file`);
        continue;
      }
      if (!claimed.has(`${name} ${subpath}`)) fail("subpath-unclaimed", `${name} ${subpath} has no map entry`);
    }
  }

  const claimedNames = new Set();
  for (const entry of byId.values()) for (const name of entryNames(entry)) claimedNames.add(name);

  /** @type {Map<string, Set<string>>} */
  const unclaimed = new Map();
  for (const [pkgName, pkg] of ctx.packages) {
    for (const file of Object.values(pkg.exports)) {
      const exported = ctx.resolver.of(file);
      for (const name of exported.values) {
        if (!isPrimitiveName(name) || claimedNames.has(name)) continue;
        const key = `${pkgName} ${relative(ctx.root, file)}`;
        if (!unclaimed.has(name)) unclaimed.set(name, new Set());
        unclaimed.get(name).add(key);
      }
    }
  }
  for (const [name, where] of [...unclaimed.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    fail("primitive-unclaimed", `${name} (${[...where].slice(0, 3).join("; ")})`);
  }

  return findings;
}

/**
 * @param {string} text
 * @param {ReturnType<typeof checkMap> extends infer _ ? any : never} map
 * @param {{ strict?: boolean }} [options]
 */
export function checkSpec(text, map, options = {}) {
  /** @type {{ level: "error" | "warn", code: string, message: string }[]} */
  const findings = [];
  const fence = text.match(/```mechanisms\n([\s\S]*?)```/);
  if (!fence) {
    const level = options.strict ? "error" : "warn";
    findings.push({
      level,
      code: "spec-fence",
      message: "no ```mechanisms fence. The prose tables are not checked.",
    });
    return findings;
  }
  let block;
  try {
    block = parseYaml(fence[1]);
  } catch (error) {
    findings.push({ level: "error", code: "spec-fence", message: `mechanisms fence did not parse: ${error.message}` });
    return findings;
  }
  const ids = new Set((map.entries ?? []).map((entry) => entry.id));
  for (const entry of map.entries ?? []) {
    for (const facet of entry.facets ?? []) {
      ids.add(`${entry.id}.${facet.id}`);
      ids.add(facet.id);
    }
  }
  // A bare facet id that collided was still added. Resolution uses the same
  // rule as the map checker only when it is unique — drop bare ids that
  // belong to more than one entry.
  const bareCount = new Map();
  for (const entry of map.entries ?? []) {
    for (const facet of entry.facets ?? []) {
      bareCount.set(facet.id, (bareCount.get(facet.id) ?? 0) + 1);
    }
  }
  for (const [id, count] of bareCount) if (count > 1) ids.delete(id);

  for (const key of ["uses", "extends", "adds"]) {
    if (!(key in block)) findings.push({ level: "error", code: "spec-key", message: `mechanisms fence is missing \`${key}\`` });
  }
  for (const key of ["uses", "extends"]) {
    const list = block[key];
    if (list == null) continue;
    if (!Array.isArray(list)) {
      findings.push({ level: "error", code: "spec-key", message: `${key} must be a list` });
      continue;
    }
    for (const id of list) {
      if (typeof id !== "string" || !ids.has(id)) {
        findings.push({ level: "error", code: "spec-id", message: `${key}: ${id} is not a map entry or facet` });
      }
    }
  }
  const adds = block.adds;
  if (adds != null && !Array.isArray(adds)) findings.push({ level: "error", code: "spec-key", message: "adds must be a list" });
  for (const row of Array.isArray(adds) ? adds : []) {
    if (!row || typeof row.name !== "string" || !row.name.trim()) {
      findings.push({ level: "error", code: "spec-adds", message: "an adds row needs a name" });
      continue;
    }
    if (!Array.isArray(row.considered) || row.considered.length === 0) {
      findings.push({ level: "error", code: "spec-adds", message: `${row.name}: considered must name the mechanisms that were looked at` });
    } else {
      for (const id of row.considered) {
        if (typeof id !== "string" || !ids.has(id)) {
          findings.push({ level: "error", code: "spec-id", message: `${row.name}: considered ${id} is not a map entry or facet` });
        }
      }
    }
    if (typeof row.because !== "string" || row.because.trim().length < 20) {
      findings.push({
        level: "error",
        code: "spec-adds",
        message: `${row.name}: because must say why those mechanisms cannot be composed, or how this one is composed from them`,
      });
    }
  }
  return findings;
}

function printFindings(findings) {
  const order = { error: 0, warn: 1, note: 2 };
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level] || a.code.localeCompare(b.code));
  for (const finding of sorted) {
    const label = finding.level === "error" ? "ERROR" : finding.level === "warn" ? "WARN" : "NOTE";
    console.log(`${label} ${finding.code}: ${finding.message}`);
  }
  const errors = findings.filter((finding) => finding.level === "error").length;
  const warns = findings.filter((finding) => finding.level === "warn").length;
  console.log(`\n${errors} error(s), ${warns} warning(s)`);
  return errors;
}

function repoContext(root) {
  const packages = loadPackages(root);
  return { root, packages, resolver: makeResolver(packages) };
}

function loadMap(root) {
  return parseYaml(readFileSync(join(root, "docs/mechanisms/map.yaml"), "utf8"));
}

function selfTest() {
  /** @type {string[]} */
  const failures = [];
  const expect = (cond, message) => {
    if (!cond) failures.push(message);
  };

  const parsed = parseYaml(`
version: 1
entries:
  - id: block
    title: "Block"
    summary: |
      One sentence
      and a second.
    builtOn: []
    overlaps:
      - id: flow
        relation: distinct-jobs
        note: |
          They are different.
`);
  expect(parsed.version === 1, "version");
  expect(parsed.entries[0].id === "block", "entry id");
  expect(parsed.entries[0].summary === "One sentence\nand a second.", `summary ${JSON.stringify(parsed.entries[0].summary)}`);
  expect(parsed.entries[0].overlaps[0].relation === "distinct-jobs", "overlap");
  expect(Array.isArray(parsed.entries[0].builtOn) && parsed.entries[0].builtOn.length === 0, "empty list");

  const badBuiltOn = checkMap(
    {
      entries: [
        {
          id: "block",
          title: "Block",
          status: "canonical",
          summary: "A block is the unit of execution, one of five kinds.",
          builtOn: ["nope"],
        },
      ],
    },
    { root: ROOT, packages: new Map(), resolver: { of: () => ({ values: new Set(), types: new Set() }) } },
  );
  expect(badBuiltOn.some((finding) => finding.code === "built-on"), "dangling builtOn should fail");

  const spec = checkSpec(
    "```mechanisms\nuses:\n  - block\nextends: []\nadds:\n  - name: a second loop\n    considered:\n      - block\n    because: \"\"\n```\n",
    {
      entries: [{ id: "block", title: "Block", facets: [] }],
    },
  );
  expect(spec.some((finding) => finding.code === "spec-adds"), "empty because should fail");

  const good = checkSpec(
    "```mechanisms\nuses:\n  - block\nextends: []\nadds: []\n```\n",
    { entries: [{ id: "block", title: "Block", facets: [] }] },
  );
  expect(good.length === 0, `clean spec should pass, got ${JSON.stringify(good)}`);

  if (failures.length) {
    console.error("self-test failed:");
    for (const failure of failures) console.error(`  ${failure}`);
    return 1;
  }
  console.log("self-test: parser and failure cases passed");
  return 0;
}

function main(argv) {
  const specIdx = argv.indexOf("--spec");
  const strict = argv.includes("--strict");
  if (argv.includes("--self-test")) {
    const code = selfTest();
    if (code !== 0) return code;
  }
  let map;
  try {
    map = loadMap(ROOT);
  } catch (error) {
    console.error(`ERROR map-parse: ${error.message}`);
    return 1;
  }
  const findings = checkMap(map, repoContext(ROOT));
  if (specIdx !== -1) {
    const specPath = argv[specIdx + 1];
    if (!specPath) {
      console.error("ERROR spec: --spec needs a file");
      return 1;
    }
    const abs = resolve(specPath);
    if (!existsSync(abs)) {
      console.error(`ERROR spec: ${specPath} does not exist`);
      return 1;
    }
    console.log(`spec ${specPath}`);
    findings.push(...checkSpec(readFileSync(abs, "utf8"), map, { strict }));
  }
  console.log(`mechanism map: ${map.entries?.length ?? 0} entries`);
  const errors = printFindings(findings);
  return errors === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
