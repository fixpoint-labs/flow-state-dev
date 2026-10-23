#!/usr/bin/env node
// FIX-2162 spec evidence, retained with the spec. Not production code.
//
// Default mode re-derives the spec's counted facts from every git-tracked file:
// which files reference each of the five client factories, by area; which
// files import the four factory-specific client types; and the placeholder
// flow kinds invented only to build a client. TOTALITY: every tracked file
// that mentions a factory name is classified as retained history, an FSD
// reference, or a listed homonym (another library's `createClient`). A file
// that is none of these fails the run, so a caller nobody listed can't hide.
//
// `--after` is the implementation's structural gate (goal leg c): outside
// retained history, nothing teaches or builds a second client. It fails on:
//   - a removed factory: the four old ones, the three route-addressed SSE
//     factories, the DevTool's `createDevTool*Client` builders;
//   - an import or export of a removed client type;
//   - a `createClient(...)` that passes `flowKind`, inline, through a spread, or
//     through a variable declared in the same file;
//   - a placeholder flow kind;
//   - a `sessionClient` / `resourceClient` / `recoveryClient` prop, option key,
//     or method call (a sub-client by name, in code or in a docs example);
//   - `transcribe` imported from, or exported by, `@flow-state-dev/client` as
//     a standalone function;
//   - `createWorkforceClient({ ... })` with options instead of the client;
//   - FACADE: a new `create*Client` factory defined in client-facing code
//     (anything but `createClient` and `createWorkforceClient`);
//   - FACADE: the fetcher called from more than one file in
//     `packages/client/src` (the spec's one request helper; internal
//     sub-clients each carry their own).
// Today's tree must FAIL it.
//
// `--control` plants one of each violation in memory and must report every
// one of them, and history alone must pass.
//
// The implementer copies this file into the goal check's directory as leg c
// (goals are the durable home); the spec's copy stays as the evidence the
// counts came from.
//
// Run from the repo root:
//   node specs/issues/FIX-2162/poc/caller-census/check.mjs            # inventory + totality
//   node specs/issues/FIX-2162/poc/caller-census/check.mjs --after    # gate: must FAIL on today's main
//   node specs/issues/FIX-2162/poc/caller-census/check.mjs --control  # negative control: must report all plants
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FACTORIES = [
  "createClient",
  "createTypedClient",
  "createSessionClient",
  "createRecoveryClient",
  "createResourceClient"
];
const REMOVED_FACTORIES = FACTORIES.slice(1);
// `Client` survives as the one client's type; the other four go.
const TYPES = ["Client", "SessionClient", "RecoveryClient", "ResourceClient", "FlowClient"];
const REMOVED_TYPES = TYPES.slice(1);
const PLACEHOLDERS = ['"flow-navigator"', '"unknown-flow"', '"__devtool__"'];
// Route-addressed stream factories. The pure `createSSEClientFromResponse` stays.
const SSE_FACTORIES = ["createSSEClient", "createSessionSSEClient", "createUserSSEClient"];
// A sub-client by its usual name: a prop, an option key, or a method call on it.
const PROP_RE = /\b(sessionClient|resourceClient|recoveryClient)(=\{|\??:|\.[a-zA-Z])/;
const ALLOWED_FACTORY_DEFS = new Set(["createClient", "createWorkforceClient"]);
/** A placeholder used AS a flow kind: within 60 chars after `flowKind`, `createClient(` or `.flow(`. */
const usesPlaceholder = (text, p) =>
  [...text.matchAll(new RegExp(p, "g"))].some((m) => /(flowKind|createClient\s*\(|\.flow\s*\()/.test(text.slice(Math.max(0, m.index - 60), m.index)));

// Retained history: never rewritten (spec-template, BP-037), allowed after.
const isHistory = (f) =>
  f.startsWith("specs/") || f.startsWith("docs/internal/") || f.startsWith(".changeset/") || /(^|\/)CHANGELOG\.md$/.test(f);
// Other libraries' `createClient`, by file, with the reason. A new homonym must
// be added here by hand, or the run fails.
const HOMONYMS = {};

const TEXT = /\.(ts|tsx|mts|mjs|cjs|js|jsx|md|mdx|html|json|yaml|yml)$/;
const FACTORY_RE = new RegExp(`\\b(${FACTORIES.join("|")})\\b`, "g");

function corpus() {
  const out = {};
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n")
    .filter((f) => f && TEXT.test(f) && !f.includes("/dist/"));
  for (const f of files) {
    try {
      out[f] = readFileSync(f, "utf8");
    } catch {
      // deleted in the working tree
    }
  }
  return out;
}

function area(f) {
  const p = f.split("/");
  if (["packages", "apps", "goals"].includes(p[0])) return `${p[0]}/${p[1]}`;
  if (p[0] === "docs") return `docs/${p[1]}`;
  return p.length === 1 ? "(root)" : p[0];
}

const importsClient = (text) => text.includes("@flow-state-dev/client");
// Goals load the checkout's client by path, or through a helper that does.
const loadsClient = (text) =>
  /"packages",\s*"client"/.test(text) || /\bshipped(\.client)?\.create/.test(text) || /loadScriptedClients/.test(text);
// A source file whose every mention sits on a comment line (a doc comment).
const commentOnly = (text) =>
  text.split("\n").filter((l) => FACTORIES.some((n) => new RegExp(`\\b${n}\\b`).test(l)))
    .every((l) => /^\s*(\/\/|\*|\/\*)/.test(l));
const isDoc = (f) => /\.(md|mdx|html)$/.test(f);

function typeImporters(text) {
  // import type { A, B } from "@flow-state-dev/client"  /  import { type A } from ...
  const found = new Set();
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@flow-state-dev\/client(?:\/[^"']*)?["']/g;
  for (const m of text.matchAll(re)) {
    for (const raw of m[1].split(",")) {
      const name = raw.replace(/\btype\s+/, "").split(/\s+as\s+/)[0].trim();
      if (TYPES.includes(name)) found.add(name);
    }
  }
  return [...found];
}

/** `createClient(` calls whose argument list names `flowKind` (the old shape). */
function oldShapeCalls(text) {
  let n = 0;
  for (const m of text.matchAll(/\bcreateClient\s*(<[^>]*>)?\s*\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    const args = text.slice(start, i - 1);
    if (/\bflowKind\b/.test(args)) n++;
    else if ([...args.matchAll(/(?:^\s*|\.\.\.)([A-Za-z_$][\w$]*)\s*(?=[,}]|$)/g)].some((v) => declaresFlowKind(text, v[1]))) n++;
  }
  return n;
}

/** Whether `name` is declared in this file as an object literal naming `flowKind`. */
function declaresFlowKind(text, name) {
  const m = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, "\\$")}\\b[^=]*=\\s*\\{`).exec(text);
  if (!m) return false;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (i < text.length && depth > 0) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    i++;
  }
  return /\bflowKind\b/.test(text.slice(start, i));
}

/** `transcribe` taken from the client package as a standalone value. */
function standaloneTranscribe(f, text) {
  const re = /import\s+\{([^}]*)\}\s*from\s*["']@flow-state-dev\/client["']/g;
  for (const m of text.matchAll(re)) {
    if (m[1].split(",").some((x) => x.trim() === "transcribe")) return true;
  }
  return f === "packages/client/src/index.ts" && /^\s*transcribe,?\s*$/m.test(text);
}

const clientFacing = (f, text) =>
  f.startsWith("packages/client/") || importsClient(text) || loadsClient(text);

function inventory(files) {
  const unclassified = [];
  const byArea = {};
  const typeFiles = {};
  const placeholders = [];
  for (const [f, text] of Object.entries(files)) {
    const names = new Set([...text.matchAll(FACTORY_RE)].map((m) => m[1]));
    for (const p of PLACEHOLDERS) {
      if (!isHistory(f) && usesPlaceholder(text, p)) placeholders.push(`${f} ${p}`);
    }
    const types = typeImporters(text);
    if (types.length > 0 && !isHistory(f) && !f.startsWith("packages/client/")) typeFiles[f] = types;
    if (names.size === 0) continue;
    if (isHistory(f)) {
      (byArea["(history)"] ??= {});
      for (const n of names) byArea["(history)"][n] = (byArea["(history)"][n] ?? 0) + 1;
      continue;
    }
    if (HOMONYMS[f]) continue;
    const fsd =
      f.startsWith("packages/client/") || importsClient(text) || loadsClient(text) || isDoc(f) || commentOnly(text);
    if (!fsd) {
      unclassified.push(f);
      continue;
    }
    const a = area(f);
    byArea[a] ??= {};
    for (const n of names) byArea[a][n] = (byArea[a][n] ?? 0) + 1;
  }
  return { unclassified, byArea, typeFiles, placeholders };
}

function after(files) {
  const violations = [];
  for (const [f, text] of Object.entries(files)) {
    if (isHistory(f) || HOMONYMS[f]) continue;
    for (const n of REMOVED_FACTORIES) if (new RegExp(`\\b${n}\\b`).test(text)) violations.push(`${f}: names ${n}`);
    for (const t of typeImporters(text)) if (REMOVED_TYPES.includes(t)) violations.push(`${f}: imports type ${t}`);
    for (const t of REMOVED_TYPES) {
      if (f.startsWith("packages/client/src/") && new RegExp(`export type ${t}\\b`).test(text)) violations.push(`${f}: exports type ${t}`);
    }
    const old = oldShapeCalls(text);
    if (old > 0) violations.push(`${f}: ${old} createClient call(s) pass flowKind`);
    for (const p of PLACEHOLDERS) if (usesPlaceholder(text, p)) violations.push(`${f}: placeholder ${p}`);
    for (const n of SSE_FACTORIES) if (new RegExp(`\\b${n}\\b`).test(text)) violations.push(`${f}: names ${n}`);
    if (/\bcreateDevTool\w*Client\b/.test(text)) violations.push(`${f}: names a createDevTool*Client builder`);
    if (PROP_RE.test(text)) violations.push(`${f}: passes, declares or calls a sub-client (sessionClient/resourceClient/recoveryClient)`);
    if (standaloneTranscribe(f, text)) violations.push(`${f}: standalone transcribe from @flow-state-dev/client`);
    if (/\bcreateWorkforceClient\s*\(\s*\{/.test(text)) violations.push(`${f}: createWorkforceClient takes options, not the client`);
    if (clientFacing(f, text) && !isDoc(f)) {
      for (const m of text.matchAll(/\b(?:function\s+|const\s+|let\s+)(create\w*Client)\b/g)) {
        if (!ALLOWED_FACTORY_DEFS.has(m[1])) violations.push(`${f}: FACADE defines ${m[1]}`);
      }
    }
  }
  const fetchers = Object.entries(files)
    .filter(([f, text]) => f.startsWith("packages/client/src/") && /\bfetcher\s*\(/.test(text))
    .map(([f]) => f);
  if (fetchers.length > 1) violations.push(`FACADE: the fetcher is called from ${fetchers.length} files in packages/client/src, not one request helper: ${fetchers.join(", ")}`);
  return violations;
}

/** Files per extra removal the spec lists, outside history (inventory only). */
function extras(files) {
  const out = { sse: [], devtoolBuilders: [], props: [], transcribe: [], workforceOptions: [] };
  for (const [f, text] of Object.entries(files)) {
    if (isHistory(f)) continue;
    if (SSE_FACTORIES.some((n) => new RegExp(`\\b${n}\\b`).test(text))) out.sse.push(f);
    if (/\bcreateDevTool\w*Client\b/.test(text)) out.devtoolBuilders.push(f);
    if (PROP_RE.test(text)) out.props.push(f);
    if (standaloneTranscribe(f, text)) out.transcribe.push(f);
    if (/\bcreateWorkforceClient\s*\(\s*\{/.test(text)) out.workforceOptions.push(f);
  }
  return out;
}

function printInventory(inv) {
  const areas = Object.keys(inv.byArea).sort((a, b) => (a === "(history)") - (b === "(history)") || a.localeCompare(b));
  console.log(["area", ...FACTORIES].join(" | "));
  const totals = Object.fromEntries(FACTORIES.map((n) => [n, 0]));
  let fileTotal = 0;
  for (const a of areas) {
    console.log([a, ...FACTORIES.map((n) => inv.byArea[a][n] ?? 0)].join(" | "));
    if (a !== "(history)") for (const n of FACTORIES) totals[n] += inv.byArea[a][n] ?? 0;
  }
  console.log(["TOTAL (excl. history)", ...FACTORIES.map((n) => totals[n])].join(" | "));
  const callerFiles = new Set();
  for (const [f, text] of Object.entries(files)) {
    if (!isHistory(f) && !HOMONYMS[f] && FACTORY_RE.test(text)) callerFiles.add(f);
    FACTORY_RE.lastIndex = 0;
  }
  fileTotal = callerFiles.size;
  const code = [...callerFiles].filter((f) => !isDoc(f)).length;
  console.log(`files naming a factory, excl. history: ${fileTotal} (code ${code}, docs ${fileTotal - code})`);
  console.log(`files importing a client type (outside packages/client): ${Object.keys(inv.typeFiles).length}`);
  const codeTouched = new Set([...[...callerFiles].filter((f) => !isDoc(f)), ...Object.keys(inv.typeFiles)]);
  const tests = [...codeTouched].filter((f) => /(^|\/)test\/|\.test\.tsx?$/.test(f)).length;
  console.log(`distinct code files to change (factory or type): ${codeTouched.size} (tests ${tests})`);
  for (const [f, t] of Object.entries(inv.typeFiles)) console.log(`  ${f}: ${t.join(", ")}`);
  console.log(`placeholder flow kinds: ${inv.placeholders.length}`);
  for (const p of inv.placeholders) console.log(`  ${p}`);
  const x = extras(files);
  console.log(`files naming a route-addressed SSE factory: ${x.sse.length}`);
  console.log(`files naming a createDevTool*Client builder: ${x.devtoolBuilders.length}`);
  console.log(`files with a sub-client prop, option or call: ${x.props.length}`);
  console.log(`files taking transcribe standalone: ${x.transcribe.length}`);
  console.log(`files calling createWorkforceClient with options: ${x.workforceOptions.length}`);
  const all = new Set([...callerFiles, ...Object.keys(inv.typeFiles), ...x.sse, ...x.devtoolBuilders, ...x.props, ...x.transcribe, ...x.workforceOptions]);
  const allCode = [...all].filter((f) => !isDoc(f));
  console.log(`all files the change touches, by these rules: ${all.size} (code ${allCode.length}, of them tests ${allCode.filter((f) => /(^|\/)(test|stories)\/|\.test\.tsx?$|\.stories\.tsx$/.test(f)).length}; docs ${all.size - allCode.length})`);
  const pk = {};
  for (const f of all) pk[area(f)] = (pk[area(f)] ?? 0) + 1;
  console.log(`  by area: ${Object.entries(pk).sort().map(([a, n]) => `${a} ${n}`).join(" · ")}`);
}

const files = corpus();
const mode = process.argv.includes("--control") ? "control" : process.argv.includes("--after") ? "after" : "inventory";

if (mode === "inventory") {
  const inv = inventory(files);
  printInventory(inv);
  if (inv.unclassified.length > 0) {
    console.log(`FAIL: ${inv.unclassified.length} unclassified file(s) name a factory:`);
    for (const f of inv.unclassified) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log(`PASS: every one of ${Object.keys(files).length} tracked text files is classified`);
} else if (mode === "after") {
  const v = after(files);
  if (v.length > 0) {
    console.log(`FAIL: ${v.length} old-client reference(s) outside retained history`);
    for (const x of (process.argv.includes("--all") ? v : v.slice(0, 40))) console.log(`  ${x}`);
    if (v.length > 40 && !process.argv.includes("--all")) console.log(`  … and ${v.length - 40} more`);
    process.exit(1);
  }
  console.log("PASS: one client; no removed factory, type, old-shape call or placeholder outside history");
} else {
  // Plant one of each violation into an otherwise-clean copy of the corpus and
  // require both checks to name every plant.
  const clean = Object.fromEntries(Object.entries(files).filter(([f]) => isHistory(f)));
  const plants = {
    "packages/zz-plant/src/homonym.ts": 'import { createClient } from "some-db";\ncreateClient();\n',
    "apps/docs/docs/zz-plant.md": "const sessions = createSessionClient({ baseUrl });\n",
    "packages/zz-plant/src/old-shape.ts":
      'import { createClient } from "@flow-state-dev/client";\nconst c = createClient({ baseUrl: f(x), flowKind: "chat", userId });\n',
    "packages/zz-plant/src/types.ts": 'import type { ResourceClient } from "@flow-state-dev/client";\n',
    "packages/zz-plant/src/placeholder.ts": 'createClient({ userId }).flow("__devtool__");\nconst flowKind = 1;\n',
    "packages/zz-plant/src/variable-shape.ts":
      'import { createClient } from "@flow-state-dev/client";\nconst opts = { baseUrl, flowKind: "chat", userId };\nconst c = createClient(opts);\n',
    "packages/zz-plant/src/sse.ts": 'import { createSessionSSEClient } from "@flow-state-dev/client";\n',
    "packages/zz-plant/src/devtool.ts": "export const c = createDevToolSessionClient(url);\n",
    "packages/zz-plant/src/prop.tsx": "<Roster resourceClient={resources} />\n",
    "apps/docs/docs/zz-sub.md": "const all = await sessionClient.listSessions();\n",
    "packages/zz-plant/src/transcribe.ts": 'import { transcribe } from "@flow-state-dev/client";\n',
    "packages/zz-plant/src/workforce.ts": "const w = createWorkforceClient({ userId, baseUrl });\n",
    "packages/zz-plant/src/facade.ts":
      'import { createClient } from "@flow-state-dev/client";\nexport function createLabClient(o) { return { sessions: createClient(o).sessions }; }\n',
    "packages/client/src/zz-sessions.ts": "export function sessionsApi(fetcher) { return () => fetcher(url); }\n",
    "packages/client/src/zz-requests.ts": "export function requestsApi(fetcher) { return () => fetcher(url); }\n"
  };
  const planted = { ...clean, ...plants };
  const inv = inventory(planted);
  const v = after(planted);
  const misses = [];
  if (!inv.unclassified.includes("packages/zz-plant/src/homonym.ts")) misses.push("inventory missed the unclassified homonym");
  for (const f of Object.keys(plants).filter((f) => !f.endsWith("homonym.ts") && !f.startsWith("packages/client/src/"))) {
    if (!v.some((x) => x.startsWith(`${f}:`))) misses.push(`--after missed ${f}`);
  }
  if (!v.some((x) => x.startsWith("FACADE: the fetcher is called from 2 files"))) misses.push("--after missed two request helpers in packages/client/src");
  // And the clean corpus (history only) must pass --after: the gate can go green.
  if (after(clean).length > 0) misses.push("--after fails on history alone: it can never pass");
  if (misses.length > 0) {
    console.log("CONTROL FAIL: the checks did not catch every plant");
    for (const m of misses) console.log(`  ${m}`);
    process.exit(1);
  }
  console.log(`CONTROL PASS: inventory flagged the unclassified homonym; --after named all ${Object.keys(plants).length - 2} planted violations (the last two plants are one violation: two request helpers); history alone passes --after`);
}
