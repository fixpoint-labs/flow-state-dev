#!/usr/bin/env node
// FIX-2769 spec evidence. Not production code: retained design evidence, run by hand.
/**
 * Re-derives every count SPEC.md states about the three apps, on any commit, by
 * running claude-code-style's inventory rules as they are today
 * (`labs/claude-code-style/test/inventory-rules.ts`) on each app's folder, with each
 * app's own entry and type scope:
 *
 *   - Teammates (`labs/teammates`): entry `src/main.tsx`, L4 outside `src/components/`.
 *   - Shift Manager (`packages/shift-manager`): entry `src/lib/connection.ts`, L4 over
 *     all of `src/` (D3 of the epic: `src/components/` and `src/surfaces/` too).
 *   - claude-code-style: as its own test runs it.
 *
 * It also keys each L3 and L4 finding as `{file, symbol, kind}`, the allowlist's key,
 * and counts the keys that repeat (two `.flow(` calls in one declaration), which is why
 * the allowlist is compared as a multiset.
 *
 * Totality: each rule's reader is the file list below it, and the script fails if a code
 * file under an app's `src/` is missing from a rule's list without being a skip on purpose:
 * the entry or a component, for L4 only. L3 reads every code file, the entry included.
 *
 * Run: node specs/issues/FIX-2769/poc/baseline/count.mts   (Node 22.18+, type stripping)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { filesUnder, hostWiring, overCaps, reachingTheServer, unclassified, unlistedTypes } from "../../../../../labs/claude-code-style/test/inventory-rules.ts";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

interface App { name: string; dir: string; entry: string; typesSkip: (rel: string) => boolean; gone: string[]; readModel: (rel: string) => boolean }
const APPS: App[] = [
  { name: "teammates", dir: "labs/teammates", entry: "src/main.tsx", typesSkip: (r) => r.startsWith("src/components/"), gone: ["src/adapter.ts", "test/fake-app.ts"], readModel: (r) => r.startsWith("src/app/") },
  { name: "shift-manager", dir: "packages/shift-manager", entry: "src/lib/connection.ts", typesSkip: () => false, gone: ["src/lib/reads.ts"], readModel: (r) => r === "src/lib/reads.ts" },
  { name: "claude-code-style", dir: "labs/claude-code-style", entry: "src/main.tsx", typesSkip: (r) => r.startsWith("src/components/"), gone: ["src/adapter.ts", "test/fake-lab.ts"], readModel: () => false },
];

const code = (rel: string) => /\.(m?ts|tsx)$/.test(rel);
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, "")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const TOP = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/;

/** The files L3 reads: every code file under `src/`. */
const l3Files = (lab: string) => filesUnder("src", lab).filter(code);
/** The files L4 reads: `.ts`/`.tsx` under `src/`, not the entry, not an app's skipped components. */
const l4Files = (lab: string, app: App) => filesUnder("src", lab).filter((rel) => /\.tsx?$/.test(rel) && rel !== app.entry && !app.typesSkip(rel));

/** L3 findings keyed `{file, symbol, kind}`: an import by its name, a call by the top-level declaration that holds it. */
function l3Keys(lab: string, entry: string): string[] {
  return l3Files(lab).flatMap((rel) => {
    const lines = strip(readFileSync(join(lab, rel), "utf8")).split("\n");
    const keys: string[] = [];
    let holder = "<module>";
    for (const line of lines) {
      const top = TOP.exec(line);
      if (top) holder = top[1]!;
      for (const m of line.matchAll(/\bimport\s+\{([^}]*)\}\s+from\s+["']@flow-state-dev\/client["']/g))
        for (const raw of m[1]!.split(",")) {
          const n = raw.trim();
          if (n === "" || n.startsWith("type ")) continue;
          const name = n.split(/\s+as\s+/)[0]!;
          if (!(rel === entry && name === "createClient")) keys.push(`${rel} · ${name} · client-import`);
        }
      for (const _ of line.matchAll(/\.flow\(/g)) keys.push(`${rel} · ${holder} · flow-call`);
      for (const _ of line.matchAll(/\.subscribe\(/g)) keys.push(`${rel} · ${holder} · subscribe-call`);
    }
    return keys;
  });
}

/** L4 with no screen list: every exported object type in the app's type scope. */
function l4All(lab: string, app: App): string[] {
  return l4Files(lab, app)
    .flatMap((rel) =>
      [...readFileSync(join(lab, rel), "utf8").matchAll(/^export\s+(?:interface\s+(\w+)\b[^=\n]*|type\s+(\w+)(?:<[^>]*>)?\s*=\s*(.*))$/gm)]
        .filter((m) => m[1] !== undefined || !/^("[^"]*"\s*\|?\s*)+;?$/.test(m[3]!.trim()))
        .map((m) => `${rel} · ${m[1] ?? m[2]} · type`),
    );
}

const lines = (abs: string) => (readFileSync(abs, "utf8").match(/\n/g) ?? []).length;
const byDir = (keys: string[]) => {
  const out: Record<string, number> = {};
  for (const k of keys) { const d = k.split(" · ")[0]!.split("/").slice(0, 2).join("/"); out[d] = (out[d] ?? 0) + 1; }
  return out;
};

let bad = 0;
for (const app of APPS) {
  const lab = join(ROOT, app.dir);
  const src = filesUnder("src", lab).filter(code);
  const l3 = l3Keys(lab, app.entry);
  const l3Lines = reachingTheServer(lab).filter((f) => !(app.entry !== "src/main.tsx" && f === `${app.entry}: imports createClient from the client`));
  const l4 = l4All(lab, app);
  const l4WithCcsList = app.typesSkip("src/components/x") ? unlistedTypes(lab).length : null;
  const repeats = l3.length - new Set(l3).size;
  const readModel = filesUnder("src", lab).filter(app.readModel).map((rel) => `${rel} ${lines(join(lab, rel))}`);
  console.log(`== ${app.name} (${app.dir}) · read ${src.length} code files under src/`);
  console.log(`  L1 unclassified: ${unclassified(lab).length}${app.name === "shift-manager" ? "  (not applied to Shift Manager, D3)" : ""}`);
  console.log(`  L2: ${JSON.stringify(overCaps(lab))}`);
  console.log(`  L3: ${l3Lines.length} finding lines in ${new Set(l3Lines.map((f) => f.split(":")[0])).size} files · ${l3.length} keyed findings, ${repeats} repeated keys`);
  console.log(`  L4 (no screen list): ${l4.length} ${JSON.stringify(byDir(l4))}${l4WithCcsList === null ? "" : ` · with claude-code-style's list: ${l4WithCcsList}`}`);
  console.log(`  H: ${existsSync(join(lab, "host.mts")) ? hostWiring(join(lab, "host.mts")).length : "no host.mts"}`);
  console.log(`  gone files still there: ${app.gone.filter((rel) => existsSync(join(lab, rel))).join(", ") || "none"}`);
  console.log(`  read-model files (ER-4): ${readModel.join(", ") || "none"}`);
  if (process.argv.includes("--keys")) for (const k of [...l3, ...l4]) console.log(`    ${k}`);
  // Totality: a code file a rule doesn't read must be a skip on purpose.
  const l3Read = new Set(l3Files(lab));
  const l4Read = new Set(l4Files(lab, app));
  const missed = src.flatMap((rel) => [
    ...(l3Read.has(rel) ? [] : [`L3 skips ${rel}`]),
    ...(l4Read.has(rel) || rel === app.entry || app.typesSkip(rel) ? [] : [`L4 skips ${rel}`]),
  ]);
  const skipped = src.filter((rel) => !l4Read.has(rel)).length;
  console.log(`  totality: L3 reads ${l3Read.size}/${src.length}; L4 reads ${l4Read.size}, skips ${skipped} on purpose (entry or components)`);
  if (src.length === 0) { console.log("  FAIL: read no files"); bad++; }
  for (const m of missed) { console.log(`  FAIL: ${m}, not the entry or an intended skip`); bad++; }
  // Claude Code-style is graded with its own screen-type list; the other two have none yet.
  const types = app.name === "claude-code-style" ? unlistedTypes(lab).length : l4.length;
  const total = l3.length + types + overCaps(lab).length + app.gone.filter((rel) => existsSync(join(lab, rel))).length;
  console.log(`  findings (L2 + L3 keys + L4 + gone files, CCS with its screen list): ${total}`);
}
process.exit(bad === 0 ? 0 : 1);
