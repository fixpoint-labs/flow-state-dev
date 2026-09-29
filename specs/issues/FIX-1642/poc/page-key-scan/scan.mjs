#!/usr/bin/env node
/**
 * FIX-1642 POC · page-key-scan — throwaway evidence, not production code.
 *
 * Question: can every API name and config key a docs page names be resolved
 * mechanically against what the packages ship, with a totality rule (every
 * inline code token classified or the run fails), and does one planted false
 * option make the run fail by name?
 *
 * No dependencies: a regex walk of each shipped package's `exports` entries
 * (following `export … from`), a property-name index, a string-literal index
 * and the mounted route templates. The committed check replaces the property
 * index with the TypeScript checker, rooted at the call each key is passed to
 * (see PLAN.md → the scan); this POC only shows the shape holds.
 *
 * Usage:
 *   node scan.mjs <page.md> [--quoted] [--plant "<token>"]
 *     --quoted   read only `>` blockquote lines (the epic's DOCS.md draft
 *                holds the page prose that way)
 *     --plant    add one token as if the page named it (the control)
 * Exit 0 = every token resolved; 1 = at least one did not (each named).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../../../..");
const args = process.argv.slice(2);
const page = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--plant");
const quotedOnly = args.includes("--quoted");
const plant = args.includes("--plant") ? args[args.indexOf("--plant") + 1] : null;
if (!page) {
  console.error("usage: node scan.mjs <page.md> [--quoted] [--plant <token>]");
  process.exit(2);
}

// ---- the shipped surface ---------------------------------------------------
const exportsBySpecifier = new Map(); // "@flow-state-dev/bullmq/schedules" -> Set(names)
const allExports = new Set();
const properties = new Set();
const literals = new Set();
const routes = new Set();

function srcFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function resolveModule(from, spec) {
  const base = resolve(dirname(from), spec.replace(/\.js$/, ""));
  for (const c of [base + ".ts", base + ".tsx", join(base, "index.ts")]) if (existsSync(c)) return c;
  return null;
}

function exportedNames(file, seen = new Set()) {
  if (!file || seen.has(file)) return new Set();
  seen.add(file);
  const text = readFileSync(file, "utf8");
  const names = new Set();
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/g)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (n) names.add(n);
    }
  }
  for (const m of text.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g)) {
    if (m[1].startsWith(".")) for (const n of exportedNames(resolveModule(file, m[1]), seen)) names.add(n);
  }
  return names;
}

for (const pkg of readdirSync(join(ROOT, "packages"))) {
  const pj = join(ROOT, "packages", pkg, "package.json");
  if (!existsSync(pj)) continue;
  const meta = JSON.parse(readFileSync(pj, "utf8"));
  if (meta.private) continue; // not shipped
  for (const [sub, target] of Object.entries(meta.exports ?? {})) {
    const entry = typeof target === "string" ? target : target.default ?? target.import;
    if (!entry || !/\.tsx?$/.test(entry) || entry.includes("*")) continue; // wildcard subpaths name no entry
    const names = exportedNames(join(ROOT, "packages", pkg, entry));
    const spec = meta.name + (sub === "." ? "" : sub.slice(1));
    exportsBySpecifier.set(spec, names);
    for (const n of names) allExports.add(n);
  }
  const src = join(ROOT, "packages", pkg, "src");
  if (!existsSync(src)) continue;
  for (const f of srcFiles(src)) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/gm)) properties.add(m[1]);
    // Method signatures on builders and interfaces (`sideChain(`, `tap<T>(`) are keys a page may name too.
    for (const m of text.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*(?:<[^>\n]*>)?\(/gm)) properties.add(m[1]);
    for (const m of text.matchAll(/["']([\w-]+)["']/g)) literals.add(m[1]);
    for (const m of text.matchAll(/path:\s*`\$\{basePath\}([^`]+)`/g)) routes.add(normRoute(m[1]));
  }
}

function normRoute(p) {
  return p.replace(/^\/api\/flows/, "").replace(/[:*][A-Za-z]+/g, "*");
}

// ---- the page's tokens -----------------------------------------------------
let text = readFileSync(page, "utf8");
if (quotedOnly) text = text.split("\n").filter((l) => l.startsWith(">")).join("\n");
const tokens = [...new Set([...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]))];
if (plant) tokens.push(plant);

// ---- classify every token (totality) ---------------------------------------
const PLACEHOLDER = /^<[^>]+>$/;
const failures = [];
const report = [];

function isName(n) {
  if (allExports.has(n)) return "export";
  if (properties.has(n)) return "key";
  return null;
}

function classify(tok) {
  const t = tok.trim();
  let m;
  if ((m = t.match(/^(@flow-state-dev\/[\w-]+(?:\/[\w-]+)?)$/))) return exportsBySpecifier.has(m[1]) ? ["package entry"] : [null, m[1]];
  if ((m = t.match(/^(GET|POST|PUT|DELETE)\s+(\/\S+)$/))) return routes.has(normRoute(m[2])) ? ["route"] : [null, m[2]];
  if ((m = t.match(/^([A-Za-z_$][\w$]*):\s*"([\w-]+)"$/))) {
    if (!properties.has(m[1])) return [null, m[1]];
    return literals.has(m[2]) ? ["key = literal"] : [null, `"${m[2]}"`];
  }
  if (/^[a-z]+(?:-[a-z]+)+$|^[a-z]+$/.test(t) && !isName(t)) return literals.has(t) ? ["literal"] : [null, t];
  // Everything else: pull out the names it uses and resolve each one.
  const names = [...t.matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]);
  const stripped = t.replace(/\(([^()]|\([^()]*\))*\)/g, "()"); // call args
  const called = [...stripped.matchAll(/([A-Za-z_$][\w$]*)\(\)/g)].map((x) => x[1]);
  const skip = new Set(["string", "number", "boolean", "input", "true", "false"]);
  const placeholders = new Set([...t.matchAll(/<([^>]+)>/g)].map((x) => x[1]));
  for (const n of names) {
    if (skip.has(n) && !called.includes(n) && n !== "input") continue;
    if (placeholders.has(n)) continue;
    if (n === "input" && /\(input\)/.test(t)) continue; // a parameter name in a shape
    const kind = called.includes(n) && !t.startsWith(".") ? (allExports.has(n) ? "export" : null) : isName(n);
    if (!kind) return [null, n];
  }
  if (called.length) return ["export/call"];
  return [/^[A-Za-z_$][\w$]*$/.test(t) ? isName(t) : "key path"];
}

for (const tok of tokens) {
  const [kind, bad] = classify(tok);
  if (kind) report.push(`  ok   ${kind.padEnd(14)} ${tok}`);
  else failures.push(`  FAIL ${tok}  → \`${bad}\` resolves to nothing shipped`);
}

console.log(`page-key-scan · ${page}${quotedOnly ? " (quoted lines)" : ""}${plant ? ` · planted: ${plant}` : ""}`);
console.log(`surface: ${exportsBySpecifier.size} entry points, ${allExports.size} exports, ${routes.size} mounted routes`);
console.log(report.join("\n"));
if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`FAIL — ${failures.length} of ${tokens.length} tokens unresolved`);
  process.exit(1);
}
console.log(`PASS — ${tokens.length} of ${tokens.length} tokens resolved`);
