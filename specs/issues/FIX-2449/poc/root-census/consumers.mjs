/**
 * Who imports engine's root, by kind of consumer. Throwaway design evidence.
 *   node specs/issues/FIX-2449/poc/root-census/consumers.mjs
 *
 * Scans tracked .ts/.tsx/.mts/.mjs files outside packages/engine for
 * `import|export { … } from "@flow-state-dev/engine"` and groups each imported
 * name by the kinds of consumer that use it: app (apps/, examples/), host (the
 * host and transport adapters), store (store adapters), lib (first-party library
 * packages), repo (goals/, labs/, plugins/, scripts/, specs/). This is the split
 * the spec's three entries follow: app → root, host/store → engine/host,
 * lib only → engine/internal, nobody → not exported.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fsReader, packageExports } from "../../../../../scripts/mechanism-exports.mjs";

const HOST = ["next", "vercel", "node", "bullmq", "mcp", "cli", "scheduled", "voice-openai"];
const STORE = ["store-postgres", "store-sqlite"];
const LIB = ["orchestration", "workforce", "testing", "shift-manager", "harness-manager", "memory", "integration-tests"];
const kind = (file) => {
  const [top, pkg] = file.split("/");
  if (top === "packages") return HOST.includes(pkg) ? "host" : STORE.includes(pkg) ? "store" : LIB.includes(pkg) ? "lib" : `pkg:${pkg}`;
  return top === "apps" || top === "examples" ? "app" : "repo";
};
const files = execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.mts", "*.mjs"], { encoding: "utf8" }).split("\n")
  .filter((f) => f && !f.startsWith("packages/engine/") && !f.startsWith("specs/issues/FIX-2449/"));
const re = /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@flow-state-dev\/engine["']/g;
// Only names engine's root really exports (a test fixture string like `export { x }` is not one).
const rootNames = (() => {
  const base = fsReader(new URL("../../../../../", import.meta.url).pathname);
  const read = (path) => {
    const text = base(path);
    if (path !== "packages/engine/package.json") return text;
    const json = JSON.parse(text);
    json.exports = { ".": json.exports["."] };
    return JSON.stringify(json);
  };
  read.packageDirs = base.packageDirs;
  read.list = base.list;
  return packageExports(read).get("@flow-state-dev/engine");
})();
const use = new Map();
for (const f of files) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  for (const m of text.matchAll(re)) for (let n of m[1].split(",")) {
    n = n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
    if (!rootNames.has(n)) continue;
    if (!use.has(n)) use.set(n, new Set());
    use.get(n).add(kind(f));
  }
}
const groups = new Map();
for (const [n, kinds] of use) {
  const k = [...kinds].sort().join("+");
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(n);
}
console.log(`engine root: ${rootNames.size} names; imported outside engine: ${use.size}; by nobody outside engine: ${rootNames.size - use.size}`);
for (const [k, names] of [...groups].sort((a, b) => b[1].length - a[1].length)) console.log(`${names.length}\t${k}\t${names.sort().join(" ")}`);
const app = [...use].filter(([, k]) => k.has("app")).map(([n]) => n).sort();
console.log(`\nused by an app or example (${app.length}): ${app.join(" ")}`);
