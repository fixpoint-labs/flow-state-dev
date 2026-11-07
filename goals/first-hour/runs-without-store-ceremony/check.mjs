#!/usr/bin/env node
// goals/first-hour/runs-without-store-ceremony (FIX-2452). Not production code.
//
// What an installed app sees, from packed tarballs in an empty project:
//   (a) no `stores` and no `session` block: `fsdev run` answers, and stderr says the app runs
//       in memory; with `stores` set, stderr says nothing about memory.
//   (b) `stores: sqliteStores({ filename })`: a second `fsdev run --session` reads the first
//       run's state, the session row is in `filename`, and a fresh `filename` does not see it.
//   (c) a typed profile naming `queue` or `scheduler` fails to typecheck, naming the slot (2 of 2);
//       a profile with `primary`, `bus` and `blobs` constructs.
//   (d) a caller action on a generator with no `itemVisibility` warns once, naming the flow, the
//       action and both fixes; `itemVisibility` set, an internal, task, webhook or schedule
//       entry, or NODE_ENV=production: no warning.
//   (e) the installed store roots export only their adapter factory and schedule index as runtime
//       values, every runtime name that left a root is on its `./host`, and importing
//       store-postgres needs no database.
//   (f) the tree's teaching files: 0 store lines, 0 empty `session` blocks on getting-started
//       pages, 0 docs pages naming a retired slot (`blobs` is not retired).
//
//   node goals/first-hour/runs-without-store-ceremony/check.mjs [--control <commit>] [--keep]
//
// `--control <commit>` packs that commit's packages (a detached worktree, installed offline and
// built) and must FAIL every signal. Anti-game: every assertion reads the answer, the stored
// row, stderr, the compiler's error or the installed module's keys; none reads workspace `src`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const args = process.argv.slice(2);
const at = args.indexOf("--control");
const control = at >= 0 ? args[at + 1] : undefined;
const keep = args.includes("--keep");
const ENTRY = ["core", "engine", "cli", "store-sqlite", "store-postgres"];

/** The runtime names the spec moves off each store root (its census, `poc/census/check.mjs`). */
const MOVED = {
  "store-sqlite": ["createSQLiteStores", "initializeSchema", "initializeSchemaDDL", "applyConnectionPragmas",
    "createSQLiteSessionStore", "createSQLiteRequestStore", "createSQLiteUserStore", "createSQLiteOrgStore",
    "createSQLiteActiveRequestRegistry", "createSQLiteCheckpointStore", "createSQLiteTraceStore",
    "createSQLiteSuspensionStore", "createSQLiteLeaseStore", "createSQLiteWakeStore"],
  "store-postgres": ["createPostgresStores", "initializeSchema", "createPgPoolTx", "createPostgresSessionStore",
    "createPostgresRequestStore", "createPostgresUserStore", "createPostgresOrgStore",
    "createPostgresActiveRequestRegistry", "createPostgresContentStore", "createPostgresResourceStateStore",
    "createPostgresCheckpointStore", "createPostgresSuspensionStore", "createPostgresLeaseStore",
    "createPostgresWakeStore"],
};
const ROOT_KEEP = { "store-sqlite": ["createSQLiteScheduleIndex", "sqliteStores"], "store-postgres": ["createPostgresScheduleIndex", "postgresStores"] };

function sh(cmd, argv, cwd, env = {}) {
  const res = spawnSync(cmd, argv, { cwd, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 << 20, timeout: 600_000 });
  return { code: res.status ?? 1, out: res.stdout ?? "", err: res.stderr ?? "" };
}
function must(cmd, argv, cwd, env) {
  const r = sh(cmd, argv, cwd, env);
  if (r.code !== 0) throw new Error(`${cmd} ${argv.join(" ")} (in ${cwd}) exited ${r.code}: ${(r.err || r.out).slice(-1500)}`);
  return r;
}

// ── Pack the entry packages and their workspace closure ────────────────────
function closure(tree) {
  const seen = new Set();
  const visit = (dir) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const m = JSON.parse(readFileSync(join(tree, "packages", dir, "package.json"), "utf8"));
    for (const [name, v] of Object.entries(m.dependencies ?? {}))
      if (String(v).startsWith("workspace:")) visit(name.replace("@flow-state-dev/", ""));
  };
  ENTRY.forEach(visit);
  return [...seen];
}

function pack(tree, dest) {
  const dirs = closure(tree);
  for (const d of dirs) must("pnpm", ["--dir", join(tree, "packages", d), "run", "build"], tree);
  return dirs.map((d) => {
    const before = new Set(readdirSync(dest));
    must("pnpm", ["--dir", join(tree, "packages", d), "pack", "--pack-destination", dest], tree);
    return join(dest, readdirSync(dest).find((f) => !before.has(f)));
  });
}

// ── The app's files ─────────────────────────────────────────────────────────
const FLOW = `import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
// No \`session\` block: the handler declares the one field it keeps.
export const tally = defineFlow({
  kind: "tally",
  actions: {
    add: {
      inputSchema: z.object({ n: z.number() }),
      block: handler({
        name: "add",
        inputSchema: z.object({ n: z.number() }),
        sessionStateSchema: z.object({ total: z.number().default(0) }),
        execute: async (input, ctx) => {
          const total = (ctx.session.state.total ?? 0) + input.n;
          await ctx.session.patchState({ total });
          return { total };
        }
      })
    }
  }
})();
`;
const config = (stores, imports = "") =>
  `import { createFlowState } from "@flow-state-dev/engine";\n${imports}import { tally } from "./flow.mjs";\n` +
  `export default createFlowState({ flows: { tally }${stores ? `, stores: ${stores}` : ""} });\n`;

function app(project, name, cfg) {
  const dir = join(project, name);
  must("mkdir", ["-p", dir], project);
  writeFileSync(join(dir, "flow.mjs"), FLOW);
  writeFileSync(join(dir, "fsdev.config.mjs"), cfg);
  return dir;
}
const fsdev = (project, dir, n, extra = [], env = {}) =>
  sh(join(project, "node_modules", ".bin", "fsdev"), ["run", "tally", "add", "-i", JSON.stringify({ n }), ...extra], dir, env);
const answered = (r, total) => r.code === 0 && r.out.includes(`"total":${total}`);

// ── Signals ─────────────────────────────────────────────────────────────────
function signalA(project) {
  const f = [];
  const bare = fsdev(project, app(project, "a-none", config(null)), 21);
  if (!answered(bare, 21)) f.push(`no stores: no answer of 21 (exit ${bare.code}): ${(bare.err || bare.out).slice(-400)}`);
  if (!/runs in memory/.test(bare.err)) f.push("no stores: stderr does not say the app runs in memory");
  const set = fsdev(project, app(project, "a-set", config("inMemoryStores()", 'import { inMemoryStores } from "@flow-state-dev/engine";\n')), 4);
  if (!answered(set, 4)) f.push(`stores set: no answer of 4 (exit ${set.code}): ${(set.err || set.out).slice(-400)}`);
  if (/memory/i.test(set.err)) f.push("stores set: stderr still says something about memory");
  return f;
}

function signalB(project) {
  const f = [];
  const dir = app(project, "b-sqlite", config("sqliteStores({ filename: process.env.TALLY_DB })", 'import { sqliteStores } from "@flow-state-dev/store-sqlite";\n'));
  const db = join(dir, "kept.db");
  const first = fsdev(project, dir, 2, ["--session", "s-kept"], { TALLY_DB: db });
  const second = fsdev(project, dir, 3, ["--session", "s-kept"], { TALLY_DB: db });
  if (!answered(first, 2)) f.push(`first run: no answer of 2 (exit ${first.code}): ${(first.err || first.out).slice(-400)}`);
  if (!answered(second, 5)) f.push(`second run: did not read the first run's total (wanted 5): ${second.out.slice(-300)}`);
  const row = sh("node", ["-e", `const D=require("better-sqlite3");const d=new D(${JSON.stringify(db)},{readonly:true});` +
    `console.log(d.prepare("select count(*) c from sessions where id like '%s-kept%'").get().c)`], project);
  if (row.out.trim() !== "1") f.push(`the session row is not in the app's file (count ${row.out.trim() || row.err.slice(-200)})`);
  const fresh = fsdev(project, dir, 3, ["--session", "s-kept"], { TALLY_DB: join(dir, "fresh.db") });
  if (!answered(fresh, 3)) f.push(`a fresh filename saw the first file's session (wanted 3): ${fresh.out.slice(-300)}`);
  return f;
}

function signalC(project) {
  const f = [];
  const tsc = join(project, "node_modules", ".bin", "tsc");
  const flags = ["--noEmit", "--strict", "--skipLibCheck", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022"];
  let named = 0;
  for (const slot of ["queue", "scheduler"]) {
    const file = join(project, `profile-${slot}.mts`);
    writeFileSync(file, `import { inMemoryStores, type CapabilitySlotMap } from "@flow-state-dev/engine";\n` +
      `export const p: CapabilitySlotMap = { primary: inMemoryStores(), ${slot}: inMemoryStores() };\n`);
    const r = sh(tsc, [...flags, file], project);
    if (r.code !== 0 && r.out.includes(`'${slot}'`)) named += 1;
    else f.push(`a profile naming \`${slot}\` typechecks (exit ${r.code})`);
  }
  const ok = sh("node", ["--input-type=module", "-e", `
    import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
    let bus; try { ({ createInMemoryBus: bus } = await import("@flow-state-dev/engine/host")); } catch {}
    const busAdapter = { capabilities: ["bus"], resolve: async () => ({ bus: bus ? bus() : undefined }) };
    const blobs = { capabilities: ["blobs"], resolve: async () => ({}) };
    const s = createFlowState({ flows: {}, stores: { default: { primary: inMemoryStores(), bus: busAdapter, blobs } } });
    await s.ready(); await s.dispose(); console.log("constructed");`], project);
  if (!ok.out.includes("constructed")) f.push(`primary, bus and blobs: did not construct: ${ok.err.slice(-300)}`);
  if (named !== 2) f.push(`retired slots named by the compiler: ${named} of 2`);
  return f;
}

function signalD(project) {
  const f = [];
  const run = (entries, env = {}) => sh("node", ["--input-type=module", "-e", `
    import { defineFlow, generator } from "@flow-state-dev/core";
    const g = (v) => generator({ name: "reply", model: "openai/gpt-6-luna", prompt: "p", ...(v ? { itemVisibility: v } : {}) });
    const warned = []; console.warn = (m) => warned.push(String(m));
    const pass = { boardId: "b", gate: (e) => e };
    defineFlow({ kind: "help-desk", authentication: { defaultUserId: "u", requireUser: false }, ${entries} })();
    console.log(JSON.stringify(warned.filter((m) => m.includes("itemVisibility"))));`], project, env);
  const read = (r) => { try { return JSON.parse(r.out.trim().split("\n").pop()); } catch { return [`unreadable: ${r.err.slice(-200)}`]; } };
  const hit = read(run(`actions: { chat: { block: g() } }`));
  if (hit.length !== 1) f.push(`silent generator action: ${hit.length} warning(s), wanted 1`);
  else for (const s of ['"help-desk"', '"chat"', "{ client: true, history: true }", "{ client: false, history: false }"])
    if (!hit[0].includes(s)) f.push(`the warning does not name ${s}`);
  const quiet = {
    "itemVisibility set": [`actions: { chat: { block: g({ client: true, history: true }) } }`],
    internal: [`actions: {}, internal: { actions: { wake: { block: g() } } }`],
    task: [`actions: {}, task: { actions: { work: { block: g(), from: pass } } }`],
    webhook: [`actions: {}, webhooks: { stripe: { on: { "invoice.paid": { block: g(), input: () => ({}) } } } }`],
    schedule: [`actions: {}, schedules: { static: { nightly: { block: g(), cron: "0 3 * * *" } } }`],
    production: [`actions: { chat: { block: g() } }`, { NODE_ENV: "production" }],
  };
  for (const [name, [entries, env]] of Object.entries(quiet)) {
    const w = read(run(entries, env));
    if (w.length) f.push(`${name}: ${w.length} warning(s), wanted none`);
  }
  return f;
}

function signalE(project) {
  const f = [];
  for (const pkg of ["store-sqlite", "store-postgres"]) {
    const r = sh("node", ["--input-type=module", "-e", `
      const root = Object.keys(await import("@flow-state-dev/${pkg}")).sort();
      let host = []; try { host = Object.keys(await import("@flow-state-dev/${pkg}/host")); } catch {}
      console.log(JSON.stringify({ root, host }));`], project, { DATABASE_URL: "", FSD_DB_URL: "" });
    let keys;
    try { keys = JSON.parse(r.out.trim().split("\n").pop()); } catch { f.push(`${pkg}: importing the root failed: ${r.err.slice(-300)}`); continue; }
    if (JSON.stringify(keys.root) !== JSON.stringify(ROOT_KEEP[pkg])) f.push(`${pkg}: root lists ${keys.root.length} runtime names (${keys.root.join(", ")})`);
    const missing = MOVED[pkg].filter((n) => !keys.host.includes(n));
    if (missing.length) f.push(`${pkg}: ${missing.length} moved name(s) not on ./host: ${missing.join(", ")}`);
  }
  return f;
}

function* files(dir) {
  for (const e of readdirSync(dir)) {
    if (["node_modules", "dist", ".next", ".docusaurus", "build"].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|mts|mjs|md|mdx)$/.test(e)) yield p;
  }
}
function signalF(tree) {
  const f = [];
  const teaching = [...files(join(tree, "apps/docs")), ...files(join(tree, "examples")),
    ...readdirSync(join(tree, "packages")).map((d) => join(tree, "packages", d, "README.md")).filter(existsSync)]
    .filter((p) => !/\/test\/|\.test\.|\.spec\./.test(p));
  const storeLines = teaching.filter((p) => /default:\s*\{\s*primary:\s*inMemoryStores\(\)\s*\}/.test(readFileSync(p, "utf8")));
  const gettingStarted = [...files(join(tree, "apps/docs/docs/getting-started"))];
  const emptySession = gettingStarted.filter((p) => /session:\s*\{\s*stateSchema:\s*z\.object\(\{\s*\}\)\s*,?\s*\}/.test(readFileSync(p, "utf8")));
  const retired = /\b(queue|scheduler)\??:\s*\w+Stores?\b|`(queue|scheduler)`[^.\n]{0,60}\bslots?\b|\bslots?\b[^.\n]{0,80}`(queue|scheduler)`/;
  const slotPages = [...files(join(tree, "apps/docs"))].filter((p) => retired.test(readFileSync(p, "utf8")));
  const rel = (ps) => ps.map((p) => relative(tree, p)).join(", ");
  if (storeLines.length) f.push(`${storeLines.length} teaching file(s) write the store line: ${rel(storeLines)}`);
  if (emptySession.length) f.push(`${emptySession.length} getting-started page(s) declare an empty session: ${rel(emptySession)}`);
  if (slotPages.length) f.push(`${slotPages.length} docs page(s) name a retired slot: ${rel(slotPages)}`);
  return f;
}

// ── Run ─────────────────────────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), "fsd-store-ceremony-"));
let tree = REPO;
let code = 0;
try {
  if (control) {
    tree = join(work, "tree");
    must("git", ["-C", REPO, "worktree", "add", "--detach", tree, control], REPO);
    must("pnpm", ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"], tree);
  }
  const tarballs = join(work, "tarballs");
  const project = join(work, "app");
  must("mkdir", ["-p", tarballs, project], work);
  console.log(`packing ${closure(tree).join(", ")} from ${control ?? "the working tree"}…`);
  const packed = pack(tree, tarballs);
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "store-ceremony-app", private: true, type: "module" }));
  must("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...packed, "zod@3", "typescript@5"], project);
  const signals = { a: () => signalA(project), b: () => signalB(project), c: () => signalC(project),
    d: () => signalD(project), e: () => signalE(project), f: () => signalF(tree) };
  for (const [id, run] of Object.entries(signals)) {
    let failures;
    try { failures = run(); } catch (err) { failures = [`threw: ${err?.message ?? err}`]; }
    console.log(`${failures.length ? "FAIL" : "PASS"}  (${id})`);
    for (const x of failures) console.log(`        ${x}`);
    if (failures.length) code = 1;
  }
} finally {
  if (control) sh("git", ["-C", REPO, "worktree", "remove", "--force", tree], REPO);
  if (!keep) rmSync(work, { recursive: true, force: true });
  else console.log(`kept ${work}`);
}
console.log(code ? "RESULT  FAIL" : "RESULT  PASS");
process.exit(code);
