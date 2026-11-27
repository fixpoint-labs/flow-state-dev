/**
 * Goal check — read across sessions: a user-scope view lists one collection's
 * rows from every session its owner has, in one query a page, hears a row
 * filed in a session made after it opened, and never shows or hears another
 * owner's (FIX-2945). The rows, the assertions and what each control fails
 * are in goal.md.
 *
 * **Model-free.** Per store (SQLite, Postgres, filesystem): a real `serve()`
 * host on a bound port with push, its door resolving the caller from
 * headers, `vault` behind a resolver of its own. Every session is born from a
 * real action at that door. The screen is the client's own `watchView` (poll
 * off) over its own socket; every assertion reads what that screen showed, a
 * view answer over HTTP, or a socket frame, never the store method's return.
 * Statements are counted at the driver (better-sqlite3's statements, the
 * Postgres executor). The D1 gate times the read inside a block on a seeded
 * store of each SQL kind.
 *
 * Run: pnpm tsx goals/sessions-reach/across-sessions/run.mts
 * Fixture: GOAL_FIXTURE=<file in fixtures/> (default `default.json`)
 * Stores: GOAL_STORES=sqlite,postgres,filesystem (default all three)
 * Controls: GOAL_CONTROL=<name> (see CONTROLS and goal.md), applied as scratch
 *   patches to the modules as this process loads them (`goals/lib/module-patch.mts`).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import pg from "pg";
import { z } from "zod";
import { defineFlow, defineResourceCollection, defineView, handler } from "@flow-state-dev/core";
import { canonicalIndexValue, declaredIndexes, type FlowInstance } from "@flow-state-dev/core/types";
import { createClient, viewRef } from "@flow-state-dev/client";
import { watchView } from "@flow-state-dev/client/internal";
import { createFlowApiRouter, createFlowRegistry, runAction, type StoreRegistry } from "@flow-state-dev/engine";
import { createFilesystemStores } from "@flow-state-dev/engine/host";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite/host";
import { createPostgresStores, type QueryExecutor } from "@flow-state-dev/store-postgres/host";
import { startPostgres, type RunningPostgres } from "../../lib/postgres.mts";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  loadFixture,
  modulePatchEnv,
  runGoal,
  silentLogger,
  sleep,
  stripIntentOverrides,
  type ModulePatch
} from "../../lib/index.mts";

stripIntentOverrides();

const SCOPE_CHANGES = "packages/engine/src/bus/scope-changes.ts";
const PRINCIPAL = "packages/engine/src/context/principal.ts";
const JS_JOIN = "packages/engine/src/stores/across-sessions.ts";
const SQLITE = "packages/store-sqlite/src/resource-state-store.ts";
const POSTGRES = "packages/store-postgres/src/resource-state-store.ts";

/** Each control swaps one rule for the wrong one, and must fail the assertion goal.md names. */
const CONTROLS: Record<string, ModulePatch[]> = {
  // No write publishes on the owner's change topic.
  "topic-off": [
    {
      module: SCOPE_CHANGES,
      from: String.raw`if \(bus !== undefined && change\.hostHasViews && !change\.lineageShared && change\.changeTopics !== undefined\) \{`,
      to: "if (false) {"
    }
  ],
  // The owner check compares the user only: in the store's join and in the per-row admission.
  "owner-user-only": [
    { module: PRINCIPAL, from: String.raw`if \(\(record\.orgId \?\? undefined\) !== principal\.orgId\) return false;`, to: "" },
    { module: PRINCIPAL, from: String.raw`return tenantMatches\(record\.tenantId \?\? undefined, principal\.tenantId\);`, to: "return true;" },
    { module: JS_JOIN, from: String.raw`    tenantId: query\.owner\.tenantId,\n    orgId: query\.owner\.orgId,\n`, to: "" },
    { module: SQLITE, from: String.raw`AND s\.tenant_id IS \? AND s\.org_id IS \? `, to: "AND (s.tenant_id IS ? OR 1) AND (s.org_id IS ? OR 1) " },
    { module: POSTGRES, from: String.raw`nullSafe\("s\.tenant_id", query\.owner\.tenantId\),\n        nullSafe\("s\.org_id", query\.owner\.orgId\),`, to: '"TRUE",\n        "TRUE",' }
  ]
};

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL ${JSON.stringify(CONTROL)}; known: ${Object.keys(CONTROLS).join(", ")}`);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const patches = CONTROLS[CONTROL]!;
  const mark = join(goalTmpDir("across-sessions"), `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(patches, REPO_ROOT, mark) }
  });
  assertPatched(patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const fixture = z
  .object({
    org: z.string().min(1),
    otherOrg: z.string().min(1),
    person: z.string().min(1),
    otherPerson: z.string().min(1),
    tenant: z.string().min(1),
    gate: z.object({
      sessions: z.number().int().positive(),
      rows: z.number().int().positive(),
      matching: z.number().int().positive(),
      page: z.number().int().positive(),
      runs: z.number().int().positive(),
      budgetMs: z.number().positive()
    })
  })
  .parse(loadFixture(import.meta.url, process.env.GOAL_FIXTURE ?? "default.json"));

const ORG = fixture.org;
const PERSON = fixture.person;
const STORES = (process.env.GOAL_STORES ?? "sqlite,postgres,filesystem").split(",").map((s) => s.trim()) as Array<"sqlite" | "postgres" | "filesystem">;
const SCRATCH = goalTmpDir("across-sessions");
/** The session `vault` keeps: sorts first, and its keys look like task ids. */
const VAULT_SESSION = "a-vault-conv";
const VAULT_ROWS = 60;
const SECRET = "task-secret";

// ── flows ───────────────────────────────────────────────────────────────────

const row = z.object({ text: z.string(), status: z.string().default("done") });
const notes = defineResourceCollection({
  pattern: "notes/*",
  scope: "session",
  stateSchema: row,
  indexes: { byStatus: (_key: string, state: { status: string }) => state.status }
});
const STATUS_INDEX = declaredIndexes(notes as unknown as { indexes: Record<string, unknown> })[0]!.stored;

const fileInput = z.object({ rows: z.array(z.object({ key: z.string(), text: z.string(), status: z.string().optional() })) });
const file = handler({
  name: "across-file",
  inputSchema: fileInput,
  outputSchema: z.object({}),
  execute: async ({ rows }, ctx) => {
    for (const r of rows) await (ctx.resources as any).notes.create(r.key, { text: r.text, ...(r.status !== undefined ? { status: r.status } : {}) });
    return {};
  }
});

type BoardAnswer = { rows: string[]; cursors: string[]; pages: number };
/** The screen: every page of `notes` across the caller's sessions, and each `next` it was handed. */
const board = handler({
  name: "across-board",
  inputSchema: z.object({}),
  outputSchema: z.object({ rows: z.array(z.string()), cursors: z.array(z.string()), pages: z.number() }),
  execute: async (_input, ctx) => {
    const out: BoardAnswer = { rows: [], cursors: [], pages: 0 };
    let after: string | undefined;
    for (;;) {
      const page = await (ctx.resources as any).acrossSessions().notes.list(after === undefined ? {} : { after });
      out.pages += 1;
      for (const r of page.rows) out.rows.push(`${r.session} ${r.key} ${r.value.text}`);
      if (page.next === undefined) return out;
      out.cursors.push(page.next);
      after = page.next;
    }
  }
});

/** The D1 gate's timings, in ms: the first filtered page and the first whole page. */
const gateTimes: { filtered: number[]; whole: number[]; filteredRows: number } = { filtered: [], whole: [], filteredRows: 0 };
const gate = handler({
  name: "across-gate",
  inputSchema: z.object({ runs: z.number() }),
  outputSchema: z.object({}),
  execute: async ({ runs }, ctx) => {
    const across = (ctx.resources as any).acrossSessions().notes;
    for (let i = 0; i < runs; i += 1) {
      let t = performance.now();
      const filtered = await across.list({ where: { index: "byStatus", value: "open" } });
      gateTimes.filtered.push(performance.now() - t);
      gateTimes.filteredRows = filtered.rows.length;
      t = performance.now();
      await across.list();
      gateTimes.whole.push(performance.now() - t);
    }
    return {};
  }
});

const desk = defineFlow({
  kind: "desk",
  actions: { file, gate },
  resources: { notes },
  views: { board: defineView({ scope: "user", block: board }) }
})() as unknown as FlowInstance;
const notebook = defineFlow({ kind: "notebook", actions: { file }, resources: { notes } })() as unknown as FlowInstance;
/** A flow with a resolver of its own, which writes the same definition: none of its sessions is the screen's to read. */
const vault = defineFlow({
  kind: "vault",
  actions: { file },
  resources: { notes },
  authentication: {
    resolvePrincipal: (context: { request?: Request }) => {
      const user = context.request?.headers.get("x-vault-user");
      return user == null ? null : { userId: user, orgId: ORG };
    }
  }
})() as unknown as FlowInstance;

function registry() {
  const flows = createFlowRegistry();
  for (const flow of [desk, notebook, vault]) flows.register(flow);
  return flows;
}

const hostResolver = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-user");
  const org = context.request?.headers.get("x-org");
  return typeof user === "string" ? { userId: user, orgId: org ?? ORG } : null;
};

// ── what the screen's socket received (a tap: nothing here changes what a client does) ──

type Frame = { url: string; at: number; raw: string; frame: { type: string; kind?: string; topic?: unknown } };
const frames: Frame[] = [];
const NativeWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class TappedWebSocket extends NativeWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    const at = String(url);
    this.addEventListener("message", (event) => frames.push({ url: at, at: Date.now(), raw: String(event.data), frame: JSON.parse(String(event.data)) }));
  }
} as typeof WebSocket;

// ── statements at the driver ────────────────────────────────────────────────

/** Every statement a SQL store ran, in order. SQLite's are taken off better-sqlite3's statements. */
const sent: string[] = [];
{
  const probe = new Database(":memory:");
  const proto = Object.getPrototypeOf(probe.prepare("SELECT 1")) as Record<string, (...args: unknown[]) => unknown>;
  probe.close();
  for (const method of ["all", "get", "run", "iterate"]) {
    const original = proto[method]!;
    proto[method] = function (this: { source: string }, ...args: unknown[]) {
      sent.push(this.source);
      return original.apply(this, args);
    };
  }
}

function countingExecutor(pool: pg.Pool): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      sent.push(text);
      const result = await pool.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
    }
  };
}

// ── one store's host ────────────────────────────────────────────────────────

type Leg = { name: "sqlite" | "postgres" | "filesystem"; stores: StoreRegistry; close(): Promise<void> };

let postgres: RunningPostgres | undefined;

async function openStores(name: Leg["name"], slug: string): Promise<Leg> {
  if (name === "filesystem") {
    const dir = join(SCRATCH, `${slug}-fs-${RUN_STAMP}`);
    mkdirSync(dir, { recursive: true });
    return { name, stores: createFilesystemStores({ rootDir: dir, developmentOnly: true }), close: async () => rmSync(dir, { recursive: true, force: true }) };
  }
  if (name === "sqlite") {
    const filename = join(SCRATCH, `${slug}-${RUN_STAMP}.db`);
    const stores = createSQLiteStores({ filename });
    return { name, stores, close: async () => rmSync(filename, { force: true }) };
  }
  postgres ??= await startPostgres({ slug: "across-sessions" });
  await postgres.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const pool = new pg.Pool({ connectionString: postgres.url, max: 4 });
  const stores = await createPostgresStores({ executor: countingExecutor(pool) });
  return {
    name,
    stores,
    close: async () => {
      await stores.close();
      await pool.end();
    }
  };
}

type Who = { userId: string; orgId: string; tenant?: string; vault?: boolean };

async function boot(leg: Leg) {
  const router = createFlowApiRouter({
    registry: registry(),
    stores: leg.stores,
    staleSweepIntervalMs: 0,
    tenantIdHeader: "x-tenant-id",
    resolvePrincipal: hostResolver,
    runtimeConfig: { logger: silentLogger }
  } as never);
  const handle: ServeHandle = await serve(router, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200 });
  const base = `http://127.0.0.1:${handle.port}`;
  const client = (who: Who) =>
    createClient({
      userId: who.userId,
      baseUrl: base,
      fetcher: (input, init) =>
        fetch(input, {
          ...init,
          headers: {
            ...(init?.headers as Record<string, string>),
            "x-user": who.userId,
            "x-org": who.orgId,
            ...(who.tenant !== undefined ? { "x-tenant-id": who.tenant } : {}),
            ...(who.vault === true ? { "x-vault-user": who.userId } : {})
          }
        })
    });
  /** File `rows` in `sessionId` on `flow`, through the door, and wait for the request to end. */
  const fileIn = async (flow: string, sessionId: string, rows: Array<{ key: string; text: string; status?: string }>, who: Who) => {
    const sentRequest = (await client(who).flow(flow).send("file", { rows }, { sessionId })) as { id: string };
    const deadline = Date.now() + 10_000;
    for (;;) {
      const record = await leg.stores.request.get(sentRequest.id);
      if (record !== undefined && record.status !== "in_progress") {
        if (record.status !== "completed") throw new Error(`setup: ${flow}/file in ${sessionId} ended ${record.status}`);
        return;
      }
      if (Date.now() > deadline) throw new Error(`setup: ${flow}/file in ${sessionId} never ended`);
      await sleep(10);
    }
  };
  return { handle, base, client, fileIn, close: () => handle.close() };
}

// ── the D1 gate ─────────────────────────────────────────────────────────────

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

async function gateOn(name: "sqlite" | "postgres"): Promise<{ filteredP95: number; wholeP95: number; filteredRows: number }> {
  const leg = await openStores(name, "gate");
  try {
    const { sessions, rows, matching } = fixture.gate;
    const perSession = Math.floor(rows / sessions);
    const every = Math.floor(rows / matching);
    const open = canonicalIndexValue("open")!;
    const done = canonicalIndexValue("done")!;
    const now = Date.now();
    const id = (i: number) => `g${String(i).padStart(5, "0")}`;
    const key = (r: number) => `notes/r${String(r).padStart(3, "0")}`;
    const record = (sid: string) =>
      JSON.stringify({ id: sid, flowKind: "desk", flowId: "desk", userId: PERSON, orgId: ORG, state: {}, version: 1, createdAt: now, updatedAt: now, journal: [], principalKind: "person" });
    if (name === "sqlite") {
      const db = new Database(join(SCRATCH, `gate-${RUN_STAMP}.db`));
      const insertSession = db.prepare(
        "INSERT INTO sessions (id, flow_kind, flow_id, user_id, org_id, tenant_id, parent_session_id, version, created_at, updated_at, data) VALUES (?, 'desk', 'desk', ?, ?, NULL, NULL, 1, ?, ?, ?)"
      );
      const insertRow = db.prepare("INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle) VALUES ('session', ?, ?, ?, 1, 'live')");
      const insertEntry = db.prepare("INSERT INTO resource_index (scope_type, scope_id, collection, index_name, value, resource_key) VALUES ('session', ?, ?, ?, ?, ?)");
      const insertBuilt = db.prepare("INSERT INTO resource_index_built (scope_type, scope_id, collection, index_name, status, build_id) VALUES ('session', ?, ?, ?, 'built', 'seed')");
      db.transaction(() => {
        for (let s = 0; s < sessions; s += 1) {
          insertSession.run(id(s), PERSON, ORG, now, now, record(id(s)));
          insertBuilt.run(id(s), notes.pattern, STATUS_INDEX);
          for (let r = 0; r < perSession; r += 1) {
            const isOpen = (s * perSession + r) % every === 0;
            insertRow.run(id(s), key(r), JSON.stringify({ text: `${id(s)}/${r}`, status: isOpen ? "open" : "done" }));
            insertEntry.run(id(s), notes.pattern, STATUS_INDEX, isOpen ? open : done, key(r));
          }
        }
      })();
      db.close();
    } else {
      const q = postgres!.query.bind(postgres);
      await q(
        `INSERT INTO sessions (id, flow_kind, flow_id, user_id, org_id, tenant_id, parent_session_id, version, created_at, updated_at, data)
         SELECT 'g' || lpad(s::text, 5, '0'), 'desk', 'desk', $1, $2, NULL, NULL, 1, $3, $3,
                jsonb_build_object('id', 'g' || lpad(s::text, 5, '0'), 'flowKind', 'desk', 'flowId', 'desk', 'userId', $1::text, 'orgId', $2::text,
                  'state', '{}'::jsonb, 'version', 1, 'createdAt', $3::bigint, 'updatedAt', $3::bigint, 'journal', '[]'::jsonb, 'principalKind', 'person')
         FROM generate_series(0, $4 - 1) AS s`,
        [PERSON, ORG, now, sessions]
      );
      await q(
        `INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle)
         SELECT 'session', 'g' || lpad(s::text, 5, '0'), 'notes/r' || lpad(r::text, 3, '0'),
                jsonb_build_object('text', s || '/' || r, 'status', CASE WHEN (s * $1 + r) % $2 = 0 THEN 'open' ELSE 'done' END), 1, 'live'
         FROM generate_series(0, $3 - 1) AS s, generate_series(0, $1 - 1) AS r`,
        [perSession, every, sessions]
      );
      await q(
        `INSERT INTO resource_index (scope_type, scope_id, collection, index_name, value, resource_key)
         SELECT 'session', 'g' || lpad(s::text, 5, '0'), $4, $5, CASE WHEN (s * $1 + r) % $2 = 0 THEN $6 ELSE $7 END, 'notes/r' || lpad(r::text, 3, '0')
         FROM generate_series(0, $3 - 1) AS s, generate_series(0, $1 - 1) AS r`,
        [perSession, every, sessions, notes.pattern, STATUS_INDEX, open, done]
      );
      await q(
        `INSERT INTO resource_index_built (scope_type, scope_id, collection, index_name, status, build_id)
         SELECT 'session', 'g' || lpad(s::text, 5, '0'), $2, $3, 'built', 'seed' FROM generate_series(0, $1 - 1) AS s`,
        [sessions, notes.pattern, STATUS_INDEX]
      );
      await q("ANALYZE");
    }
    gateTimes.filtered.length = 0;
    gateTimes.whole.length = 0;
    const result = await runAction({
      flow: desk,
      actionName: "gate",
      input: { runs: fixture.gate.runs },
      sessionId: "gate-runner",
      stores: leg.stores,
      userId: PERSON,
      orgId: ORG,
      principalKind: "person",
      source: "http",
      runtimeConfig: { requestHost: { flows: registry() }, hostResolver, logger: silentLogger }
    } as never);
    if ((result as { error?: unknown }).error !== undefined) throw new Error(`gate: the timing run failed: ${String((result as { error: unknown }).error)}`);
    // The first runs warm the statement caches and the planner: graded on the rest, as a warm server answers.
    const warm = Math.min(10, Math.floor(fixture.gate.runs / 4));
    return { filteredP95: p95(gateTimes.filtered.slice(warm)), wholeP95: p95(gateTimes.whole.slice(warm)), filteredRows: gateTimes.filteredRows };
  } finally {
    await leg.close();
  }
}

// ── the rows ────────────────────────────────────────────────────────────────

const BOARD = viewRef("desk", "board");
const ALICE: Who = { userId: PERSON, orgId: ORG };
const OTHERS: Array<[string, Who, string]> = [
  ["other-user", { userId: fixture.otherPerson, orgId: ORG }, "bob-conv"],
  ["other-org", { userId: PERSON, orgId: fixture.otherOrg }, "other-org-conv"],
  ["other-tenant", { userId: PERSON, orgId: ORG, tenant: fixture.tenant }, "other-tenant-conv"]
];

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const answers: Record<string, string[]> = {};
  try {
    for (const name of tell.over("stores", STORES)) {
      const leg = await openStores(name, "main");
      const env = await boot(leg);
      const tag = (assertion: string) => `${assertion}:${name}`;
      try {
        // Sessions born at the door: three of alice's on two flows, the others', and vault's.
        await env.fileIn("desk", "conv-1", [{ key: "1", text: "first", status: "open" }, { key: "2", text: "second" }], ALICE);
        await env.fileIn("desk", "conv-2", [{ key: "1", text: "third" }], ALICE);
        await env.fileIn("notebook", "notebook-1", [{ key: "1", text: "fourth", status: "open" }], ALICE);
        for (const [, who, sessionId] of OTHERS) await env.fileIn("desk", sessionId, [{ key: "1", text: `not ${PERSON}@${ORG}'s` }], who);
        await env.fileIn(
          "vault",
          VAULT_SESSION,
          Array.from({ length: VAULT_ROWS }, (_, i) => ({ key: `${SECRET}-${String(i).padStart(3, "0")}`, text: "vaulted" })),
          { ...ALICE, vault: true }
        );

        // One query a page, at the driver: one view call, before any screen is open to read beside it.
        if (name !== "filesystem") {
          sent.length = 0;
          const answer = (await env.client(ALICE).view(BOARD, {})).value as BoardAnswer;
          const reads = tell.over(`one-query-per-page · ${name} · statements reading rows`, sent.filter((sql) => /\bresource_state\b/i.test(sql)));
          if (reads.length !== answer.pages) failures.push(`${tag("one-query-per-page")} · ${answer.pages} pages took ${reads.length} statements on resource_state: ${reads.map((sql) => sql.replace(/\s+/g, " ").slice(0, 120)).join(" | ")}`);
          if (!reads.every((sql) => /\bsessions\b/i.test(sql))) failures.push(`${tag("one-query-per-page")} · a row read did not join sessions`);
          const sessionReads = sent.filter((sql) => /\bfrom\s+sessions\b/i.test(sql) && !/\bresource_state\b/i.test(sql));
          if (sessionReads.length !== 0) failures.push(`${tag("one-query-per-page")} · ${sessionReads.length} session reads beside the page's query`);
          evidence.push(`${name}: ${answer.pages} pages, ${reads.length} row statements, ${sessionReads.length} session reads`);
        }

        // The screen: the client's own watcher, poll off, over its own socket.
        const screen = env.client(ALICE);
        let shown: BoardAnswer | undefined;
        const stop = watchView(screen as never, BOARD, {}, { onValue: (value: unknown) => (shown = value as BoardAnswer) }, { pollIntervalMs: null });
        for (let i = 0; i < 500 && shown === undefined; i += 1) await sleep(10);
        if (shown === undefined) throw new Error(`setup: the screen never showed the board on ${name}`);
        const expected = ["conv-1 notes/1 first", "conv-1 notes/2 second", "conv-2 notes/1 third", "notebook-1 notes/1 fourth"];
        if (JSON.stringify(shown.rows) !== JSON.stringify(expected)) failures.push(`${tag("rows-from-every-session")} · the screen showed ${JSON.stringify(shown.rows)}`);
        answers[name] = shown.rows;

        // Other owners write after the screen opened: no row, no notice.
        const before = frames.length;
        for (const [, who, sessionId] of OTHERS) await env.fileIn("desk", sessionId, [{ key: "late", text: "late elsewhere" }], who);
        await sleep(1_000);
        const heardFromOthers = frames.slice(before).filter((f) => f.frame.type === "notice");
        tell.over(`other-owners · ${name} · writes made`, OTHERS);
        if (heardFromOthers.length !== 0) failures.push(`${tag("other-owners-no-notice")} · the screen heard ${heardFromOthers.map((f) => f.raw).join(" | ").slice(0, 300)}`);

        // A session made after the screen opened files a row: heard within 2 s, and shown.
        const filedAt = Date.now();
        await env.fileIn("desk", "made-later", [{ key: "1", text: "late" }], ALICE);
        let lateAt: number | undefined;
        for (let i = 0; i < 300 && lateAt === undefined; i += 1) {
          if (shown.rows.includes("made-later notes/1 late")) lateAt = Date.now();
          else await sleep(10);
        }
        if (lateAt === undefined || lateAt - filedAt > 2_000) {
          failures.push(`${tag("late-row-appears")} · ${lateAt === undefined ? "never shown within 3 s" : `shown after ${lateAt - filedAt} ms`}; the screen shows ${JSON.stringify(shown.rows)}`);
        } else evidence.push(`${name}: the late row shown ${lateAt - filedAt} ms after its write`);

        // The custom-resolver flow writes the same definition: the screen may wake, but learns nothing.
        const beforeVault = frames.length;
        await env.fileIn("vault", VAULT_SESSION, [{ key: `${SECRET}-late`, text: "vaulted late" }], { ...ALICE, vault: true });
        await sleep(500);
        const fresh = (await screen.view(BOARD, {})).value as BoardAnswer;
        const said = JSON.stringify(fresh) + frames.slice(0).map((f) => f.raw).join("");
        tell.over(`custom-resolver · ${name} · cursors handed back`, fresh.cursors);
        if (said.includes(VAULT_SESSION) || said.includes(SECRET)) {
          failures.push(`${tag("custom-resolver-names-nothing")} · a page, a cursor or a frame named ${said.includes(VAULT_SESSION) ? VAULT_SESSION : SECRET}`);
        }
        evidence.push(`${name}: vault's write woke ${frames.slice(beforeVault).filter((f) => f.frame.type === "notice").length} notice(s); ${fresh.cursors.length} sealed cursor(s), none naming it`);

        // Every other owner's row is absent from a fresh answer.
        for (const [who, , sessionId] of tell.over(`other-owners · ${name} · cases`, OTHERS)) {
          if (fresh.rows.some((r) => r.startsWith(`${sessionId} `))) failures.push(`${tag(`${who}-never-appears`)} · the answer shows ${sessionId}'s rows`);
        }
        stop();
      } finally {
        await env.close();
        await leg.close();
      }
    }

    // The filesystem store answers what the SQL stores do, in the same order.
    const legs = Object.keys(answers);
    for (const name of legs) {
      if (JSON.stringify(answers[name]) !== JSON.stringify(answers[legs[0]!])) failures.push(`same-answer:${name} · ${JSON.stringify(answers[name])} vs ${legs[0]} ${JSON.stringify(answers[legs[0]!])}`);
    }

    // D1's gate, on each SQL store.
    for (const name of STORES.filter((s): s is "sqlite" | "postgres" => s !== "filesystem")) {
      const measured = await gateOn(name);
      const { sessions, rows, matching, page, budgetMs } = fixture.gate;
      evidence.push(
        `gate ${name}: ${sessions} sessions, ${rows} rows, ${matching} matching; first page of ${page}: filtered p95 ${measured.filteredP95.toFixed(2)} ms (${measured.filteredRows} rows), whole p95 ${measured.wholeP95.toFixed(2)} ms; budget ${budgetMs} ms`
      );
      if (measured.filteredRows !== page) failures.push(`gate:${name} · the filtered first page held ${measured.filteredRows} rows, not ${page}`);
      if (measured.filteredP95 >= budgetMs) failures.push(`gate:${name} · filtered first page p95 ${measured.filteredP95.toFixed(2)} ms ≥ ${budgetMs} ms`);
      if (measured.wholeP95 >= budgetMs) failures.push(`gate:${name} · whole first page p95 ${measured.wholeP95.toFixed(2)} ms ≥ ${budgetMs} ms`);
    }
    return { failures, evidence: evidence.join("\n") };
  } finally {
    await postgres?.stop();
  }
});
