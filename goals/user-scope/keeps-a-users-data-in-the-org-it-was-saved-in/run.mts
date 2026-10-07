/**
 * Goal check — a user who works in two orgs sees, in each, only what they
 * saved there, on an ordinary app flow.
 *
 * Real path, no mocking, no model, out of CI: the real HTTP router over
 * on-disk SQLite. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/user-scope/keeps-a-users-data-in-the-org-it-was-saved-in/run.mts
 * Control: GOAL_CONTROL=cross-org-key (the user key without the org) must FAIL
 * leg b on "b:globex-shared".
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { FLOW_ID, notesApp, verified } from "./fixtures/notes-app";

type Fixture = {
  alice: string;
  bob: string;
  acme: string;
  globex: string;
  markers: { state: string; shared: string; isolated: string };
};
type Who = { user: string; org: string };
type Router = ReturnType<typeof createFlowApiRouter>;

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);
const control = process.env.GOAL_CONTROL;
if (control !== undefined && control !== "cross-org-key") {
  throw new Error(`Unknown GOAL_CONTROL "${control}". This goal understands: cross-org-key.`);
}

/**
 * `cross-org-key`: every user key loses its org on the way to the store, so
 * the cell a run reads is the user's in every org — the key derivation
 * without the org. Done at the store boundary so the product code is
 * untouched; it changes where data lands, never what the check reads.
 */
function dropOrgFromUserKeys(stores: StoreRegistry): StoreRegistry {
  /** Split on unescaped `:`, keeping each part's escaped spelling. */
  const parts = (key: string): string[] => {
    const out: string[] = [];
    let current = "";
    for (let i = 0; i < key.length; i += 1) {
      const ch = key[i]!;
      if (ch === "\\") {
        current += ch + (key[i + 1] ?? "");
        i += 1;
      } else if (ch === ":") {
        out.push(current);
        current = "";
      } else current += ch;
    }
    out.push(current);
    return out;
  };
  const strip = (key: string): string => {
    const p = parts(key);
    return p[1] === "~org" ? [p[0], ...p.slice(3)].join(":") : key;
  };
  const byKey = <T extends object>(store: T): T =>
    new Proxy(store, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (key: unknown, ...rest: unknown[]) =>
          value.call(target, typeof key === "string" ? strip(key) : key, ...rest);
      },
    });
  const byScope = <T extends object>(store: T): T =>
    new Proxy(store, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (scope: unknown, scopeId: unknown, ...rest: unknown[]) =>
          value.call(
            target,
            scope,
            scope === "user" && typeof scopeId === "string" ? strip(scopeId) : scopeId,
            ...rest,
          );
      },
    });
  return new Proxy(stores, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "user") return byKey(value as object);
      if (prop === "resourceState" || prop === "content") return byScope(value as object);
      return value;
    },
  });
}

function host(stores: StoreRegistry): Router {
  const registry = createFlowRegistry();
  registry.register(notesApp() as unknown as FlowInstance);
  return createFlowApiRouter({
    registry,
    stores: control === "cross-org-key" ? dropOrgFromUserKeys(stores) : stores,
    resolvePrincipal: verified.resolvePrincipal,
    runtimeConfig: { logger: silentLogger },
  } as never);
}

async function call(
  router: Router,
  method: "GET" | "POST",
  path: string[],
  who: Who,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await router[method](
    new Request(`http://goal/api/flows/${path.map(encodeURIComponent).join("/")}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-verified-user": who.user,
        "x-verified-org": who.org,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: { path } },
  );
  const text = await res.text();
  return { status: res.status, json: text.length > 0 ? JSON.parse(text) : undefined };
}

/** Open a session, run one action, wait for it to settle; the session id. */
async function runOnce(
  router: Router,
  who: Who,
  action: "save" | "read",
  input: unknown,
  failures: string[],
  label: string,
): Promise<string> {
  const opened = await call(router, "POST", [FLOW_ID, "sessions"], who, { userId: who.user });
  if (opened.status !== 201) {
    throw new Error(`${label}: open session expected 201, got ${opened.status} ${JSON.stringify(opened.json)}`);
  }
  const sessionId = opened.json.session.id as string;
  const posted = await call(router, "POST", [FLOW_ID, sessionId, "actions", action], who, {
    userId: who.user,
    input,
  });
  if (posted.status !== 202) failures.push(`${label}: ${action} expected 202, got ${posted.status}`);
  const requestId = posted.json?.request?.id as string;
  for (let i = 0; i < 400; i += 1) {
    const status = (await call(router, "GET", [FLOW_ID, "requests", requestId, "status"], who)).json?.status;
    if (status !== undefined && !["pending", "in_progress", "running", "queued"].includes(status)) {
      if (status !== "completed") failures.push(`${label}: ${action} ended ${status}`);
      return sessionId;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  failures.push(`${label}: ${action} did not settle`);
  return sessionId;
}

/** Everything one caller gets back: by a run, the state route and the resource routes. */
async function view(router: Router, who: Who, failures: string[], label: string) {
  const sessionId = await runOnce(router, who, "read", {}, failures, label);
  const seen = await call(router, "GET", ["sessions", sessionId, "resources", "seen"], who);
  const run = (seen.json?.items?.[0]?.clientData ?? {}) as { state?: string | null; shared?: string[]; isolated?: string[] };
  const state = await call(router, "GET", ["sessions", sessionId, "state"], who);
  const shared = await call(router, "GET", ["sessions", sessionId, "resources", "notes"], who);
  const isolated = await call(router, "GET", ["sessions", sessionId, "resources", "scratch"], who);
  for (const [name, res] of [["state", state], ["notes", shared], ["scratch", isolated]] as const) {
    if (res.status !== 200) failures.push(`${label}: ${name} route expected 200, got ${res.status}`);
  }
  return {
    run,
    stateRoute: JSON.stringify(state.json?.clientData?.user ?? null),
    sharedRoute: JSON.stringify(shared.json ?? null),
    isolatedRoute: JSON.stringify(isolated.json ?? null),
  };
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const { markers } = fixture;
  const aliceAcme: Who = { user: fixture.alice, org: fixture.acme };
  const aliceGlobex: Who = { user: fixture.alice, org: fixture.globex };
  const bobAcme: Who = { user: fixture.bob, org: fixture.acme };
  const dir = mkdtempSync(join(tmpdir(), "fsd-user-scope-"));
  const dbFile = join(dir, "goal.db");

  // ---- Alice saves in Acme -------------------------------------------------
  let stores = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  await runOnce(host(stores), aliceAcme, "save", markers, failures, "save");
  // Nothing below is served from the context that wrote it.
  (stores as unknown as { close(): void }).close();
  stores = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  const router = host(stores);

  // ---- leg a: her next Acme run reads back all three ------------------------
  const a = await view(router, aliceAcme, failures, "a");
  if (a.run.state !== markers.state) failures.push(`a:run-state — expected ${markers.state}, got ${a.run.state}`);
  if (!a.run.shared?.includes(markers.shared)) failures.push(`a:run-shared — missing ${markers.shared}`);
  if (!a.run.isolated?.includes(markers.isolated)) failures.push(`a:run-isolated — missing ${markers.isolated}`);
  if (!a.stateRoute.includes(markers.state)) failures.push(`a:state-route — missing ${markers.state}`);
  if (!a.sharedRoute.includes(markers.shared)) failures.push(`a:shared-route — missing ${markers.shared}`);
  if (!a.isolatedRoute.includes(markers.isolated)) failures.push(`a:isolated-route — missing ${markers.isolated}`);
  evidence.push(`a: Alice in ${fixture.acme} read back all three markers by a run, /state and both resource routes`);

  // ---- leg b: Alice in Globex and Bob in Acme read none --------------------
  for (const [who, tag] of [[aliceGlobex, "globex"], [bobAcme, "bob"]] as const) {
    const b = await view(router, who, failures, `b:${tag}`);
    const seenByRun = [b.run.state ?? "", ...(b.run.shared ?? []), ...(b.run.isolated ?? [])].join(" ");
    const all = [seenByRun, b.stateRoute, b.sharedRoute, b.isolatedRoute];
    if (all.some((text) => text.includes(markers.shared))) {
      failures.push(`b:${tag}-shared — ${who.user}@${who.org} reads Alice's shared marker`);
    }
    if (all.some((text) => text.includes(markers.state))) {
      failures.push(`b:${tag}-state — ${who.user}@${who.org} reads Alice's user state`);
    }
    if (all.some((text) => text.includes(markers.isolated))) {
      failures.push(`b:${tag}-isolated — ${who.user}@${who.org} reads Alice's flow-isolated marker`);
    }
    // A read that saw nothing because it never ran proves nothing.
    if (b.run.shared === undefined) failures.push(`b:${tag}-ran — the read run recorded nothing`);
  }
  evidence.push(
    `b: Alice in ${fixture.globex} and Bob in ${fixture.acme} read none of the three by a run, /state or the resource routes`,
  );
  if (control !== undefined) evidence.push(`control ${control} active`);

  (stores as unknown as { close(): void }).close();
  return { failures, evidence: evidence.join("; ") };
});
