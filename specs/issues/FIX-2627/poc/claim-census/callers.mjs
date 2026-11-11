#!/usr/bin/env node
// FIX-2627 spec POC. Retained design evidence, not production code. Throwaway.
/**
 * Who calls what FIX-2627 makes internal or removes, outside packages/workforce:
 * hireWorkforce, createWorkerInstallation, the loader's readers, and the
 * React panels' old subpath. Grouped by where the caller lives, because the
 * spec's D2 turns on how many are goal checks.
 *
 *   node specs/issues/FIX-2627/poc/claim-census/callers.mjs
 *   CALLERS_CONTROL=1 node specs/issues/FIX-2627/poc/claim-census/callers.mjs
 *
 * Totality: every source file is read once; a file is a caller if it names any
 * entry, and it is counted once per entry and once in the union. The control
 * plants a caller of each entry and fails unless every one is counted.
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "../../../../..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".next", ".turbo"]);
const SOURCE = /\.(?:ts|tsx|mts|cts|mjs|js)$/;
const ENTRIES = {
  hireWorkforce: /\bhireWorkforce\b/,
  createWorkerInstallation: /\bcreateWorkerInstallation\b/,
  readDeclaredRoster: /\breadDeclaredRoster\b/,
  "readWorkforce (and the other readers)": /\b(?:readWorkforce|readWorkforceDirectory|readWorkerSkills|readTeamsDirectory|readResourcesDirectory|readReferencesDirectory|readPackagesDirectory)\s*\(/,
  "@flow-state-dev/react/workforce": /@flow-state-dev\/react\/workforce\b/,
};

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (SOURCE.test(e.name)) out.push(full);
  }
  return out;
}

const group = (rel) => {
  if (rel.startsWith("goals/")) return "goals";
  if (/^(apps|labs)\//.test(rel) || /^packages\/shift-manager\//.test(rel)) return "apps, labs, shift-manager";
  if (rel.startsWith("packages/")) return "other packages";
  return "scripts, docs";
};

export function count(files, read) {
  const table = {};
  const union = new Map();
  for (const file of files) {
    const rel = path.relative(REPO, file).split(path.sep).join("/");
    if (rel.startsWith("specs/") || rel.startsWith("packages/workforce/")) continue;
    const text = read(file);
    for (const [entry, re] of Object.entries(ENTRIES)) {
      if (!re.test(text)) continue;
      const g = group(rel);
      table[entry] ??= {};
      table[entry][g] = (table[entry][g] ?? 0) + 1;
      union.set(rel, g);
    }
  }
  return { table, union };
}

if (process.env.CALLERS_CONTROL === "1") {
  const planted = Object.keys(ENTRIES).map((entry, i) => path.join(REPO, `goals/planted-${i}/host.mts`));
  const body = ["hireWorkforce(x)", "createWorkerInstallation({})", "readDeclaredRoster(r)", "readTeamsDirectory (r)", 'from "@flow-state-dev/react/workforce"'];
  const { table, union } = count(planted, (f) => body[planted.indexOf(f)]);
  const ok = Object.keys(ENTRIES).every((e) => table[e]?.goals === 1) && union.size === planted.length;
  console.log(ok ? "control ok: each planted caller counted once" : `CONTROL FAILED: ${JSON.stringify(table)}`);
  process.exit(ok ? 0 : 1);
}

const files = walk(REPO, []);
const { table, union } = count(files, (f) => fs.readFileSync(f, "utf8"));
for (const [entry, groups] of Object.entries(table)) {
  console.log(`${entry}: ${Object.entries(groups).map(([g, n]) => `${g} ${n}`).join(" · ")}`);
}
const unionBy = {};
for (const g of union.values()) unionBy[g] = (unionBy[g] ?? 0) + 1;
console.log(`\nfiles calling any of them: ${union.size} · ${Object.entries(unionBy).map(([g, n]) => `${g} ${n}`).join(" · ")}`);
const goalDirs = new Set([...union.entries()].filter(([, g]) => g === "goals").map(([rel]) => rel.split("/").slice(0, 3).join("/")));
console.log(`goal checks (goals/<area>/<goal>) with a caller: ${goalDirs.size}`);
