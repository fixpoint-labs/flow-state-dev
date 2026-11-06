#!/usr/bin/env node
/**
 * Throwaway evidence for the FIX-2452 spec. Re-derives the counted facts SPEC.md rests on:
 *   1. every root export of store-sqlite and store-postgres is classified (root · host),
 *      and every store name engine's root publishes is classified (root · host) — totality;
 *   2. which of them anything outside the owning package imports (the consumer census);
 *   3. how many files spell the stores ceremony, split into tests and the rest.
 * Run from the repo root:  node specs/issues/FIX-2452/poc/census/check.mjs [--plant]
 * `--plant` injects an unclassified root export into store-sqlite; the check must then FAIL.
 * Not production code; not run by CI.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fsReader, packageExports } from "../../../../../scripts/mechanism-exports.mjs";

const plant = process.argv.includes("--plant");
const base = fsReader(process.cwd());
const read = Object.assign((p) => {
  const t = base(p);
  return plant && p === "packages/store-sqlite/src/index.ts" ? `${t}\nexport const plantedUnclassified = 1;\n` : t;
}, base);

// The spec's classification (SPEC.md → What changes). Anything not named here fails totality.
const ROOT = {
  "@flow-state-dev/store-sqlite": ["sqliteStores", "SQLiteStoreOptions", "createSQLiteScheduleIndex"],
  "@flow-state-dev/store-postgres": ["postgresStores", "PostgresStoreOptions", "PoolConfig", "createPostgresScheduleIndex"]
};
const HOST = {
  "@flow-state-dev/store-sqlite": ["createSQLiteStores", "SQLiteStoreRegistry", "SQLiteTraceStoreOptions", "CreateSQLiteRequestStoreOptions",
    "initializeSchema", "initializeSchemaDDL", "applyConnectionPragmas", "createSQLiteSessionStore", "createSQLiteRequestStore",
    "createSQLiteUserStore", "createSQLiteOrgStore", "createSQLiteActiveRequestRegistry", "createSQLiteCheckpointStore",
    "createSQLiteTraceStore", "createSQLiteSuspensionStore", "createSQLiteLeaseStore", "createSQLiteWakeStore"],
  "@flow-state-dev/store-postgres": ["createPostgresStores", "PostgresStoreRegistry", "initializeSchema", "createPgPoolTx", "QueryExecutor",
    "TxClient", "PostgresBus", "createPostgresSessionStore", "createPostgresRequestStore", "createPostgresUserStore",
    "createPostgresOrgStore", "createPostgresActiveRequestRegistry", "createPostgresContentStore", "createPostgresResourceStateStore",
    "createPostgresCheckpointStore", "createPostgresSuspensionStore", "createPostgresLeaseStore", "createPostgresWakeStore"]
};
const ENGINE_ROOT = ["inMemoryStores", "filesystemStores", "StoreAdapter", "CapabilitySlot", "CapabilitySlotMap", "StoresConfig"];
const ENGINE_STORE = /^(create(InMemory|Filesystem)\w*(Store|Stores|Registry)|inMemoryStores|filesystemStores|StoreAdapter|CapabilitySlot\w*|StoresConfig|CreateStoreOptions|FilesystemStoreRegistryOptions)$/;

const index = packageExports(read);
let failed = false;
const fail = (m) => { failed = true; console.log(`FAIL  ${m}`); };

// Consumer census: named imports of a package from files outside it.
const SKIP = new Set(["node_modules", "dist", ".next", ".fsdev", ".git", "specs"]);
function* files(dir) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|mts|mjs|md|mdx)$/.test(e)) yield p;
  }
}
const corpus = ["packages", "apps", "examples", "goals", "scripts"].flatMap((d) => [...files(d)]);
function consumers(pkg, selfDir) {
  const out = new Map();
  const re = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*["']${pkg}["']`, "g");
  for (const f of corpus) {
    if (f.startsWith(selfDir + "/")) continue;
    for (const m of readFileSync(f, "utf8").matchAll(re))
      for (let n of m[1].split(",")) {
        n = n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
        if (n) (out.get(n) ?? out.set(n, new Set()).get(n)).add(f.split("/").slice(0, 2).join("/"));
      }
  }
  return out;
}

for (const [pkg, keep] of Object.entries(ROOT)) {
  const names = [...index.get(pkg).keys()];
  const used = consumers(pkg, `packages/${pkg.split("/")[1]}`);
  const moved = names.filter((n) => HOST[pkg].includes(n));
  for (const n of names) if (!keep.includes(n) && !HOST[pkg].includes(n)) fail(`${pkg}: root export "${n}" is in neither the root nor the ./host list`);
  for (const n of HOST[pkg]) if (!names.includes(n)) fail(`${pkg}: spec moves "${n}" to ./host, but the root does not export it`);
  console.log(`\n${pkg}: ${names.length} root exports → root ${keep.length} · ./host ${moved.length}`);
  for (const n of keep) if (!names.includes(n)) fail(`${pkg}: spec keeps "${n}" on the root, but it is not exported`);
  for (const n of moved) {
    const by = used.get(n);
    console.log(`  host      ${n.padEnd(36)} ${by ? [...by].join(" ") : "— no outside consumer"}`);
  }
  const perStore = moved.filter((n) => /^create(SQLite|Postgres)\w+(Store|Registry)$/.test(n));
  const usedPerStore = perStore.filter((n) => used.has(n));
  console.log(`  per-store constructors: ${perStore.length}, imported outside the package: ${usedPerStore.length}`);
}

const engine = [...index.get("@flow-state-dev/engine").keys()].filter((n) => ENGINE_STORE.test(n));
const engineUsed = consumers("@flow-state-dev/engine", "packages/engine");
const host = engine.filter((n) => !ENGINE_ROOT.includes(n));
console.log(`\n@flow-state-dev/engine: ${engine.length} store names on the root → root ${engine.length - host.length} · engine/host ${host.length}`);
for (const n of host) console.log(`  host      ${n.padEnd(36)} ${engineUsed.has(n) ? [...engineUsed.get(n)].join(" ") : "— no outside consumer"}`);
for (const n of ENGINE_ROOT) if (!engine.includes(n)) fail(`engine: spec keeps "${n}" on the root, but it is not exported`);

// The ceremony.
const ceremony = corpus.filter((f) => /default:\s*\{\s*primary:\s*inMemoryStores\(\)\s*\}/.test(readFileSync(f, "utf8")));
const tests = ceremony.filter((f) => /\/test\/|\.test\.|\.spec\./.test(f));
console.log(`\nceremony "default: { primary: inMemoryStores() }": ${ceremony.length} files · ${tests.length} tests · ${ceremony.length - tests.length} docs, READMEs, examples, fixtures`);

console.log(failed ? "\nRESULT  FAIL" : "\nRESULT  PASS");
process.exit(failed ? 1 : 0);
