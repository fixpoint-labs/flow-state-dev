/**
 * Root census: re-derives the counted facts this spec rests on.
 * Throwaway design evidence, not production code. Run from the repo root:
 *
 *   node specs/issues/FIX-2449/poc/root-census/census.mjs            # roots only
 *   node specs/issues/FIX-2449/poc/root-census/census.mjs --public   # every public entry
 *   node specs/issues/FIX-2449/poc/root-census/census.mjs --plant    # negative control
 *
 * It reads one entry at a time through the walker the anchor check already uses
 * (scripts/mechanism-exports.mjs → packageExports), by overlaying each package.json
 * so its exports map holds that one entry. `/internal` entries and publishConfig-hidden
 * test entries (`./inbox/check`) never count: adopters do not import them.
 *
 * Reports: engine root size by source area, and the names it declares in another
 * package; every name two foundation entries export from DIFFERENT declaring files
 * (a collision); `*PackageMarker` and import-proof scaffolding on any root.
 * Exits 1 while any collision exists. --plant adds one fake name to both react's and
 * client's roots: the count must rise by one, or the assertion is not wired.
 */
import { fsReader, packageExports } from "../../../../../scripts/mechanism-exports.mjs";

const ROOT = new URL("../../../../../", import.meta.url).pathname;
const FOUNDATION = ["contracts", "core", "engine", "client", "react", "testing"].map((p) => `@flow-state-dev/${p}`);
const args = new Set(process.argv.slice(2));
const hidden = (key) => /internal|\/check$/.test(key);

const base = fsReader(ROOT);
const dirOf = new Map();
for (const d of base.packageDirs()) {
  const t = base(`packages/${d}/package.json`);
  if (t) dirOf.set(JSON.parse(t).name, d);
}
const publicKeys = (pkg) => Object.keys(JSON.parse(base(`packages/${dirOf.get(pkg)}/package.json`)).exports ?? {}).filter((k) => !hidden(k));

/** name → { file, type } for exactly one entry of one package. */
function entryExports(pkg, key) {
  const pkgJson = `packages/${dirOf.get(pkg)}/package.json`;
  const read = (path) => {
    const text = base(path);
    if (path === pkgJson) {
      const json = JSON.parse(text);
      json.exports = { [key]: json.exports[key] };
      return JSON.stringify(json);
    }
    if (args.has("--plant") && key === "." && /packages\/(react|client)\/src\/index\.ts$/.test(path)) {
      return `${text}\nexport type CensusPlant = { from: "${path}" };\n`;
    }
    return text;
  };
  read.packageDirs = base.packageDirs;
  read.list = base.list;
  return packageExports(read).get(pkg) ?? new Map();
}

const entries = []; // { entry, names }
for (const pkg of FOUNDATION) {
  for (const key of args.has("--public") ? publicKeys(pkg) : ["."]) {
    entries.push({ entry: key === "." ? pkg : `${pkg}${key.slice(1)}`, names: entryExports(pkg, key) });
  }
}

// 1. Engine root: size, by source area, and names declared in another package.
const engine = entries.find((e) => e.entry === "@flow-state-dev/engine").names;
const byArea = {};
const foreign = [];
for (const [name, { file }] of engine) {
  if (!file.startsWith("packages/engine/")) { foreign.push(`${name} ← ${file}`); continue; }
  const area = file.replace("packages/engine/src/", "").split("/")[0].replace(/\.ts$/, "");
  byArea[area] = (byArea[area] ?? 0) + 1;
}

// 2. One name, two entries, different declarations.
const owners = new Map();
for (const { entry, names } of entries) for (const [name, { file }] of names) {
  if (!owners.has(name)) owners.set(name, []);
  owners.get(name).push({ entry, file });
}
const collisions = [];
let shared = 0;
for (const [name, list] of owners) {
  if (list.length < 2) continue;
  if (new Set(list.map((x) => x.file)).size > 1) collisions.push({ name, list });
  else shared++;
}
const short = (s) => s.replace("@flow-state-dev/", "");

// 3. Scaffolding on any root.
const markers = [];
for (const { entry, names } of entries) for (const n of names.keys()) if (/PackageMarker$|ImportProof$/.test(n)) markers.push(`${short(entry)} → ${n}`);

console.log("entry sizes:", Object.fromEntries(entries.map((e) => [short(e.entry), e.names.size])));
console.log(`engine root: ${engine.size} names`, byArea);
console.log(`engine root names declared in another package (${foreign.length}):`);
for (const f of foreign) console.log("  ", f);
console.log(`collisions — one name, different declarations (${collisions.length}):`);
for (const c of collisions) console.log("  ", `${c.name}: ${c.list.map((x) => `${short(x.entry)} (${x.file})`).join(" vs ")}`);
console.log(`shared re-exports — one declaration on several entries: ${shared}`);
console.log(`markers and import proofs (${markers.length}):`);
for (const m of markers) console.log("  ", m);

// The assertion the export check gains.
if (collisions.length) {
  console.error(`FAIL: ${collisions.length} collision(s)`);
  process.exitCode = 1;
}
