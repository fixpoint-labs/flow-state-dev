/**
 * realtime › scope changes reach other sessions (FIX-1506).
 *
 * One `serve()` host on a bound port, on FIX-2426's crossing double so no
 * view keeps its fallback timer, and three React views rendered in this
 * process (react-dom over a happy-dom document; Node's own `fetch` and
 * `WebSocket`). Each view is `useSession(id, { live: true })` with the hooks
 * an app already uses: `useClientData` for org and user state (an org
 * `client.derived` license count among them) and `useResourceCollectionList`
 * for the org's licenses. Every assertion reads what a view rendered, or the
 * reads its own fetcher made.
 *
 *   a  — user A patches org state and adds an org license; user B's view of
 *        another session shows the plan, the derived count and the row
 *        within 1 s. A desk added to a second collection runs no read of
 *        B's licenses.
 *   b  — A patches user state; A's second tab, on another session, shows it
 *        within 1 s, and B's view makes no read.
 *   c  — as a, from a run started with `runAction` and no stream.
 *   d  — A's own live view, sending its changes, makes the same reads per
 *        change as A's view without `live` does for the same changes.
 *
 * Controls (each runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=no-publish  the scope-change publish cut out: a, b and c must FAIL.
 *   GOAL_CONTROL=no-origin   the writer's skip of its own notice off: d must FAIL.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Window } from "happy-dom";
import { createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createClient } from "@flow-state-dev/client";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  runAction,
  type StoreRegistry
} from "@flow-state-dev/engine";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import {
  FlowProvider,
  useClientData,
  useResourceCollectionList,
  useSession,
  type SessionView
} from "@flow-state-dev/react";
import { crossingBus } from "../../lib/crossing-bus.mts";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  modulePatchEnv,
  runGoal,
  type ModulePatch
} from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("realtime-scope-changes");
const BOUND_MS = 1_000;
const ORG = "acme";

const PATCHES: Record<string, ModulePatch[]> = {
  // Every resource and scope-state notice goes nowhere: the run's two seams
  // and the resource routes all publish through this one helper.
  "no-publish": [
    {
      module: "packages/engine/src/bus/scope-changes.ts",
      from: String.raw`if \(bus === undefined\) return;`,
      to: "return;"
    }
  ],
  // The writer's view no longer skips the notice its own request made.
  "no-origin": [
    {
      module: "packages/react/src/hooks/useSession.ts",
      from: String.raw`if \(notice\.origin !== undefined && ownRequestIdsRef\.current\.has\(notice\.origin\.requestId\)\) return;`,
      to: ""
    }
  ]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

// ---------------------------------------------------------------------------
// A DOM for react-dom, and nothing else: fetch and WebSocket stay Node's own
// ---------------------------------------------------------------------------

const happy = new Window();
Object.assign(globalThis, { window: happy, document: happy.document, IS_REACT_ACT_ENVIRONMENT: false });

// ---------------------------------------------------------------------------
// The app: org and user state, an org license collection with a derived count,
// and a second org collection
// ---------------------------------------------------------------------------

const licenses = defineResourceCollection({
  pattern: "licenses/*",
  scope: "org",
  stateSchema: z.object({ name: z.string().default("") }),
  client: { state: { read: true } }
});

const desks = defineResourceCollection({
  pattern: "desks/*",
  scope: "org",
  stateSchema: z.object({ name: z.string().default("") }),
  client: { state: { read: true } }
});

function deskFlow(): FlowInstance {
  const act = (name: string, execute: (input: { value: string }, ctx: any) => Promise<unknown>) =>
    handler({ name, inputSchema: z.object({ value: z.string() }), outputSchema: z.object({}).passthrough(), execute });
  return defineFlow({
    kind: "desk",
    resources: { licenses, desks },
    org: {
      stateSchema: z.object({ plan: z.string().default("free") }),
      client: {
        expose: ["plan"],
        derived: { licenseCount: async ({ resources }) => (resources.licenses as { count(): Promise<number> }).count() }
      }
    },
    user: {
      stateSchema: z.object({ theme: z.string().default("light") }),
      client: { expose: ["theme"] }
    },
    actions: {
      setPlan: { inputSchema: z.object({ value: z.string() }), block: act("set-plan", async ({ value }, ctx) => (await ctx.org.patchState({ plan: value }), {})) },
      addLicense: { inputSchema: z.object({ value: z.string() }), block: act("addLicense", async ({ value }, ctx) => (await ctx.resources.licenses.create(value, { name: value }), {})) },
      addDesk: { inputSchema: z.object({ value: z.string() }), block: act("add-desk", async ({ value }, ctx) => (await ctx.resources.desks.create(value, { name: value }), {})) },
      setTheme: { inputSchema: z.object({ value: z.string() }), block: act("set-theme", async ({ value }, ctx) => (await ctx.user.patchState({ theme: value }), {})) }
    }
  })() as unknown as FlowInstance;
}

/** Bearer token → user. Everyone is in one org. */
const tokens = new Map<string, string>([
  ["tok-alice", "alice"],
  ["tok-bob", "bob"]
]);

type Host = { handle: ServeHandle; base: string; stores: StoreRegistry; flow: FlowInstance };

async function host(): Promise<Host> {
  const flow = deskFlow();
  const registry = createFlowRegistry();
  registry.register(flow);
  const stores: StoreRegistry = { ...createInMemoryStores(), bus: crossingBus() };
  const router = createFlowApiRouter({
    registry,
    stores,
    staleSweepIntervalMs: 0,
    resolvePrincipal: (context) => {
      const user = tokens.get((context.request?.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
      return user === undefined ? null : { userId: user, orgId: ORG };
    }
  });
  const handle = await serve(router, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200 });
  return { handle, base: `http://127.0.0.1:${handle.port}`, stores, flow };
}

// ---------------------------------------------------------------------------
// A view: one React root, a fetcher that adds the token and counts reads
// ---------------------------------------------------------------------------

type Read = { at: number; kind: "state" | "state-only" | "licenses" | "desks" | "other" };
type Shown = { at: number; plan: unknown; licenseCount: unknown; theme: unknown; licenses: string[] };

type View = {
  name: string;
  reads: Read[];
  shown: Shown[];
  session: () => SessionView | undefined;
  close(): void;
};

function readKind(url: string): Read["kind"] {
  if (/\/sessions\/[^/]+\/state/.test(url)) return url.includes("include_items=false") ? "state-only" : "state";
  if (/\/resources\/licenses(\?|$)/.test(url)) return "licenses";
  if (/\/resources\/desks(\?|$)/.test(url)) return "desks";
  return "other";
}

function mountView(name: string, on: Host, userId: string, token: string, sessionId: string, live: boolean): View {
  const reads: Read[] = [];
  const shown: Shown[] = [];
  let current: SessionView | undefined;
  const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if ((init?.method ?? "GET") === "GET") reads.push({ at: Date.now(), kind: readKind(url) });
    return fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${token}` } });
  };

  function Screen() {
    const session = useSession(sessionId, { flowKind: "desk", live });
    const { org, user } = useClientData(session, { org: ["plan", "licenseCount"], user: ["theme"] });
    const list = useResourceCollectionList<{ name: string }>(session, "licenses");
    current = session;
    const row: Omit<Shown, "at"> = {
      plan: org.plan,
      licenseCount: org.licenseCount,
      theme: user.theme,
      licenses: list.items.map((item) => item.topic).sort()
    };
    const key = JSON.stringify(row);
    useEffect(() => {
      shown.push({ at: Date.now(), ...row });
    }, [key]);
    return null;
  }

  const container = happy.document.createElement("div");
  const root: Root = createRoot(container as unknown as Element);
  root.render(createElement(FlowProvider, { userId, baseUrl: on.base, fetcher, children: createElement(Screen) }));
  return { name, reads, shown, session: () => current, close: () => root.unmount() };
}

/** Send `action` as a plain client of `userId`, and return when the run is saved, read off the host's store. */
async function write(on: Host, token: string, userId: string, sessionId: string, action: string, value: string): Promise<number> {
  const fsd = createClient({
    userId,
    baseUrl: on.base,
    fetcher: (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${token}` } })
  });
  const sent = await fsd.flow("desk").send(action, { value }, { sessionId });
  return savedAt(on, sent.id);
}

async function savedAt(on: Host, requestId: string): Promise<number> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const record = await on.stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return Date.now();
    if (Date.now() > deadline) throw new Error(`setup: request ${requestId} never finished`);
    await delay(5);
  }
}

async function newSession(on: Host, token: string, userId: string): Promise<string> {
  const fsd = createClient({
    userId,
    baseUrl: on.base,
    fetcher: (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${token}` } })
  });
  return (await fsd.flow("desk").createSession()).id;
}

/** When `view` first rendered a row matching `match`, waiting up to `withinMs`. */
async function shownAt(view: View, match: (row: Shown) => boolean, withinMs: number): Promise<number | undefined> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const hit = view.shown.find(match);
    if (hit !== undefined) return hit.at;
    if (Date.now() > deadline) return undefined;
    await delay(10);
  }
}

async function until(check: () => boolean, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await delay(10);
  }
  return true;
}

/** Wait until `view` has made no read for `quietMs`. */
async function settled(view: View, quietMs = 600): Promise<void> {
  for (;;) {
    const last = view.reads[view.reads.length - 1]?.at ?? 0;
    const wait = last + quietMs - Date.now();
    if (wait <= 0) return;
    await delay(wait);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const readsSince = (view: View, n: number, kind?: Read["kind"]) =>
  view.reads.slice(n).filter((r) => kind === undefined || r.kind === kind);

// ---------------------------------------------------------------------------
// The legs
// ---------------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const views: View[] = [];
  const on = await host();
  try {
    const sA1 = await newSession(on, "tok-alice", "alice");
    const sA2 = await newSession(on, "tok-alice", "alice");
    const sB = await newSession(on, "tok-bob", "bob");
    const viewA2 = mountView("A's second tab", on, "alice", "tok-alice", sA2, true);
    const viewB = mountView("B", on, "bob", "tok-bob", sB, true);
    views.push(viewA2, viewB);
    // The derived count renders once the first snapshot lands; org and user
    // state read as unset until someone writes them.
    const ready = await until(() => viewB.shown.some((r) => r.licenseCount === 0) && viewA2.shown.some((r) => r.licenseCount === 0), 5_000);
    if (!ready) failures.push("setup: the views never rendered their first snapshot");
    await settled(viewB);
    await settled(viewA2);

    // a · A patches org state and adds an org license; B shows both within 1 s.
    {
      const planSaved = await write(on, "tok-alice", "alice", sA1, "setPlan", "pro");
      const planShown = await shownAt(viewB, (r) => r.plan === "pro", 3_000);
      const licenseSaved = await write(on, "tok-alice", "alice", sA1, "addLicense", "ada");
      const rowShown = await shownAt(viewB, (r) => r.licenses.includes("ada"), 3_000);
      const countShown = await shownAt(viewB, (r) => r.licenseCount === 1, 3_000);
      const lat = {
        plan: planShown === undefined ? undefined : planShown - planSaved,
        row: rowShown === undefined ? undefined : rowShown - licenseSaved,
        count: countShown === undefined ? undefined : countShown - licenseSaved
      };
      const graded = tell.over("a:within-1s · B's renders showing A's changes", Object.values(lat).filter((v): v is number => v !== undefined));
      for (const [what, ms] of Object.entries(lat)) {
        if (ms === undefined) failures.push(`a:within-1s: B's view never showed A's ${what} change within 3 s`);
        else if (ms >= BOUND_MS) failures.push(`a:within-1s: B's view showed A's ${what} change ${ms} ms after saved (bound ${BOUND_MS})`);
      }
      if (graded.length === 3 && graded.every((ms) => ms < BOUND_MS)) {
        evidence.push(`a: B shows plan ${lat.plan} ms, license row ${lat.row} ms, derived count ${lat.count} ms after saved`);
      }

      // A change to a second collection runs no read of B's licenses.
      await settled(viewB);
      const before = viewB.reads.length;
      await write(on, "tok-alice", "alice", sA1, "addDesk", "d1");
      await delay(800);
      const licenseReads = readsSince(viewB, before, "licenses");
      tell.over("a:other-collection · B's reads after the desk", readsSince(viewB, before), { emptyIs: "B may read nothing at all for a desk" });
      if (licenseReads.length !== 0) failures.push(`a:other-collection: a desk added ran ${licenseReads.length} reads of B's licenses`);
      else evidence.push("a: a desk added ran 0 reads of B's licenses");
    }

    // b · A patches user state; A's second tab shows it, B reads nothing.
    {
      await settled(viewB);
      const bBefore = viewB.reads.length;
      const saved = await write(on, "tok-alice", "alice", sA1, "setTheme", "dark");
      const shown = await shownAt(viewA2, (r) => r.theme === "dark", 3_000);
      await delay(800);
      const lat = tell.over("b:within-1s · A's second tab showing the theme", shown === undefined ? [] : [shown - saved]);
      if (lat.length === 0) failures.push("b:within-1s: A's second tab never showed A's user change within 3 s");
      else if (lat[0]! >= BOUND_MS) failures.push(`b:within-1s: A's second tab showed it ${lat[0]} ms after saved (bound ${BOUND_MS})`);
      const bReads = tell.over("b:b-reads-nothing · B's reads after A's user change", readsSince(viewB, bBefore), { emptyIs: "the claim: B makes no read" });
      if (bReads.length !== 0) failures.push(`b:b-reads-nothing: B made ${bReads.length} reads for A's user change`);
      if (viewB.shown.some((r) => r.theme === "dark")) failures.push("b:b-reads-nothing: B's view showed A's theme");
      if (lat.length > 0 && lat[0]! < BOUND_MS && bReads.length === 0) evidence.push(`b: A's second tab shows the theme ${lat[0]} ms after saved; B made 0 reads`);
    }

    // c · the same org write from a run with no stream.
    {
      const sWorker = await newSession(on, "tok-alice", "alice");
      const run = await runAction({
        orgId: ORG,
        flow: on.flow,
        actionName: "setPlan" as never,
        input: { value: "enterprise" } as never,
        userId: "alice",
        sessionId: sWorker,
        stores: on.stores,
        runtimeConfig: {}
      });
      const saved = Date.now();
      if (run.error !== undefined) failures.push(`c: setup: the run failed: ${String(run.error)}`);
      const hired = await runAction({
        orgId: ORG,
        flow: on.flow,
        actionName: "addLicense" as never,
        input: { value: "grace" } as never,
        userId: "alice",
        sessionId: sWorker,
        stores: on.stores,
        runtimeConfig: {}
      });
      const hiredAt = Date.now();
      if (hired.error !== undefined) failures.push(`c: setup: the hire failed: ${String(hired.error)}`);
      const planShown = await shownAt(viewB, (r) => r.plan === "enterprise", 3_000);
      const rowShown = await shownAt(viewB, (r) => r.licenses.includes("grace"), 3_000);
      const lat = [planShown === undefined ? undefined : planShown - saved, rowShown === undefined ? undefined : rowShown - hiredAt];
      const graded = tell.over("c:within-1s · B's renders showing the worker's changes", lat.filter((v): v is number => v !== undefined));
      if (graded.length < 2) failures.push("c:within-1s: B's view never showed a change from a run with no stream within 3 s");
      else if (graded.some((ms) => ms >= BOUND_MS)) failures.push(`c:within-1s: B showed the worker's changes ${graded.join(", ")} ms after saved (bound ${BOUND_MS})`);
      else evidence.push(`c: from a run with no stream, B shows plan ${graded[0]} ms, row ${graded[1]} ms after saved`);
    }

    // d · A's own view reads per change as a view without `live` does.
    {
      const perChange = async (live: boolean, suffix: string): Promise<number[]> => {
        const sOwn = await newSession(on, "tok-alice", "alice");
        const own = mountView(live ? "A live" : "A plain", on, "alice", "tok-alice", sOwn, live);
        views.push(own);
        await until(() => own.session()?.isLoading === false && own.shown.length > 0, 5_000);
        await settled(own, 1_000);
        const counts: number[] = [];
        for (const [action, value] of [["setPlan", `plan-${suffix}`], ["addLicense", `license-${suffix}`]] as const) {
          const before = own.reads.length;
          await own.session()!.sendAction(action, { value });
          await until(() => own.session()?.isStreaming === false, 5_000);
          await settled(own, 1_000);
          counts.push(own.reads.slice(before).filter((r) => r.kind !== "other").length);
        }
        own.close();
        return counts;
      };
      const plain = await perChange(false, "p");
      const live = await perChange(true, "l");
      tell.over("d:reads-as-plain · A's reads per change, without live", plain);
      tell.over("d:reads-as-plain · A's reads per change, live", live);
      if (JSON.stringify(plain) !== JSON.stringify(live)) {
        failures.push(`d:reads-as-plain: A's live view read ${live.join(", ")} times per change; without live, ${plain.join(", ")}`);
      } else evidence.push(`d: A's own view reads ${live.join(", ")} per change (plan, license), as without live`);
    }
  } finally {
    for (const view of views) view.close();
    await on.handle.close();
  }
  return { failures, evidence: evidence.join(" · ") };
});
