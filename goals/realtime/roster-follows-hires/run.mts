/**
 * realtime › the roster follows hires (FIX-2412).
 *
 * One `serve()` host on a bound port with Kitchen Sink's workforce tree, on
 * the crossing double (`goals/lib/crossing-bus.mts`), and each app's own
 * roster view, with real clients (Node's `fetch` and `WebSocket`):
 *
 *   - Kitchen Sink's `TeamPanel`, rendered by react-dom over a happy-dom
 *     document, read off the rows it draws;
 *   - Shift Manager's `useRoster`, under its real `LabProvider`, read off what
 *     the hook hands back;
 *   - the Teammates lab's adapter, `watchWorkers`, read off the rows it reports.
 *
 * Each view has its own credential, so its reads are counted at its own
 * fetcher (Shift Manager's `connect` uses the global `fetch`, so its reads are
 * told apart by its token). A roster read is counted where it lists the user's
 * own workers' collection. Alice's other tab is a separate client.
 *
 *   a  — alice's other tab hires, forks, edits and fires; then a worker's
 *        turn with no stream hires (`runAction`). Each of alice's views shows
 *        each change within 1 s of its request completing. Then a 10 s idle
 *        window: no view reads the roster.
 *   b  — bob's views, open the whole time, read nothing during alice's
 *        changes and never show her workers.
 *   c  — the same views on a host with no push (`serve({ push: false })`):
 *        a hire shows within the fallback pace (3 s) + 1 s.
 *   d  — Kitchen Sink's rail, on the tree with a second coordinator
 *        `WORKER.md`: it lists exactly the two coordinators.
 *
 * `a:within-1s` covers the Workers panel, not the rail: the rail reads the
 * roster at each listing, and when its listing re-runs is FIX-2411's. `d`
 * covers what the rail lists.
 *
 * Controls (each runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=read-once  the watch reads at start and ignores notices and the timer: a and c must FAIL.
 *   GOAL_CONTROL=hand-list  the rail lists `support.help` by hand: d must FAIL.
 *   GOAL_CONTROL=timer      the watch keeps a timer of its own with the socket up: a:quiet and b's reads must FAIL.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import * as React from "react";
import { createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createClient, type Client } from "@flow-state-dev/client";
import { createFlowApiRouter, createFlowRegistry, createInProcessFetch, runAction, type StoreRegistry } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { COORDINATOR_FLOW, createWorkerInstallation, defineAgentWorkerFlow, defineCoordinatorFlow, hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { createWorkforceClient, ROSTER_FLOW, type RosterEntry } from "@flow-state-dev/workforce/browser";
import { crossingBus } from "../../lib/crossing-bus.mts";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, type ModulePatch } from "../../lib/index.mts";
import { buildKitchenSinkWorkforce, workforceRoot } from "../../../apps/kitchen-sink/workforce/hire.ts";
import { TeamPanel } from "../../../apps/kitchen-sink/components/team-panel.tsx";
import { railSessions } from "../../../apps/kitchen-sink/lib/rail-sessions.ts";
import { ROUTE_MODEL } from "../../../apps/kitchen-sink/lib/models.ts";
import { LabProvider } from "../../../packages/shift-manager/src/lib/lab-data.tsx";
import { useRoster } from "../../../packages/shift-manager/src/lib/roster.ts";
import { createLabAdapter, type LabWorker } from "../../../labs/teammates/src/adapter.ts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("realtime-roster-follows");
const BOUND_MS = 1_000;
const FALLBACK_MS = 3_000;
const IDLE_MS = 10_000;
const ORG = "acme";

const PATCHES: Record<string, ModulePatch[]> = {
  // The watch reads once, at start: every notice and every tick is ignored.
  "read-once": [
    {
      module: "packages/workforce/src/workers/client.ts",
      from: String.raw`if \(rosterMayHaveChanged\(notice\)\) reads\.request\(\);`,
      to: "void notice;",
    },
  ],
  // A timer of the watch's own beside its subscription, as a view that kept a poll would.
  timer: [
    {
      module: "packages/workforce/src/workers/client.ts",
      from: String.raw`const subscription = fsd\.subscribe\(\[topic\.user\(\)\], \{`,
      to: "const ownTimer = setInterval(() => reads.request(), ROSTER_POLL_MS); void ownTimer; const subscription = fsd.subscribe([topic.user()], {",
    },
  ],
  // The rail's coordinators kept by hand, as `SHELL_COORDINATORS` was.
  "hand-list": [
    {
      module: "apps/kitchen-sink/lib/rail-sessions.ts",
      from: String.raw`\(await workforce\.roster\(\)\)\.filter\(\(worker\) => isCoordinatorFlow\(worker\.flow\)\)`,
      to: `[{ id: "support.help" }]`,
    },
  ],
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
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) },
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

// ---------------------------------------------------------------------------
// A DOM for react-dom, and nothing else: fetch and WebSocket stay Node's own
// ---------------------------------------------------------------------------

const happy = new Window();
// tsx compiles the apps' `.tsx` files with the classic JSX transform, which calls the global `React`.
Object.assign(globalThis, { window: happy, document: happy.document, IS_REACT_ACT_ENVIRONMENT: false, React });

/** Each credential's user. A view's token is its own, so its reads are its own. */
const TOKENS: Record<string, string> = {
  "tok-alice-ks": "alice",
  "tok-alice-sm": "alice",
  "tok-alice-tm": "alice",
  "tok-alice-tab": "alice",
  "tok-bob-ks": "bob",
  "tok-bob-sm": "bob",
  "tok-bob-tm": "bob",
};

type Read = { at: number; url: string };
/** Roster reads by token: a read lists the user's own workers' collection once. */
const rosterReads = new Map<string, Read[]>();
const isRosterRead = (url: string) => url.includes("workforceWorkers") && !url.includes("workforceStandardWorkers");
const realFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const auth = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("authorization") ?? "";
  const token = auth.replace(/^Bearer /, "");
  if (isRosterRead(url) && token in TOKENS) {
    const list = rosterReads.get(token) ?? [];
    list.push({ at: Date.now(), url });
    rosterReads.set(token, list);
  }
  return realFetch(input, init);
};

// ---------------------------------------------------------------------------
// The hosts
// ---------------------------------------------------------------------------

type Host = { handle: ServeHandle; base: string; stores: StoreRegistry; roster: FlowInstance };

async function host(push: boolean): Promise<Host> {
  const { copies } = await buildKitchenSinkWorkforce();
  const registry = createFlowRegistry();
  for (const copy of copies) registry.register(copy);
  const stores: StoreRegistry = { ...createInMemoryStores(), bus: crossingBus() };
  const router = createFlowApiRouter({
    registry,
    stores,
    staleSweepIntervalMs: 0,
    resolvePrincipal: (context) => {
      const token = (context.request?.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      return TOKENS[token] !== undefined ? { userId: TOKENS[token]!, orgId: ORG } : null;
    },
  });
  const handle = await serve(router, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200, push });
  const roster = copies.find((copy) => (copy as unknown as { kind?: string }).kind === ROSTER_FLOW);
  if (roster === undefined) throw new Error("setup: the tree registers no roster flow");
  return { handle, base: `http://127.0.0.1:${handle.port}`, stores, roster };
}

function clientOf(on: Host, token: string): Client {
  return createClient({
    userId: TOKENS[token]!,
    baseUrl: on.base,
    fetcher: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${token}`);
      return globalThis.fetch(input, { ...init, headers });
    },
  });
}

// ---------------------------------------------------------------------------
// Each app's own view, normalized to what it shows: worker id → description
// ---------------------------------------------------------------------------

type Shown = ReadonlyMap<string, string | null>;
type Seen = Array<{ at: number; value: Shown }>;
type Views = { ks: Seen; sm: Seen; tm: Seen; tokens: Record<"ks" | "sm" | "tm", string>; close: () => void };

function mountViews(on: Host, user: "alice" | "bob"): Views {
  const tokens = { ks: `tok-${user}-ks`, sm: `tok-${user}-sm`, tm: `tok-${user}-tm` };
  const ks: Seen = [];
  const sm: Seen = [];
  const tm: Seen = [];
  const record = (seen: Seen, value: Shown) => {
    const last = seen[seen.length - 1]?.value;
    if (last !== undefined && JSON.stringify([...last]) === JSON.stringify([...value])) return;
    seen.push({ at: Date.now(), value });
  };

  // Kitchen Sink: the Workers panel, read off its rows.
  const ksContainer = happy.document.createElement("div");
  const ksRoot: Root = createRoot(ksContainer as unknown as Element);
  ksRoot.render(createElement(TeamPanel, { workforce: createWorkforceClient(clientOf(on, tokens.ks)), onTalk: async () => {} }));
  const ksTimer = setInterval(() => {
    const rows = [...ksContainer.querySelectorAll("[data-worker-id]")];
    if (rows.length === 0) return;
    record(ks, new Map(rows.map((row) => [row.getAttribute("data-worker-id")!, row.querySelector("p")?.textContent ?? null])));
  }, 10);

  // Shift Manager: the roster hook under its real provider, read off what it hands back.
  function Probe() {
    const read = useRoster();
    const entries = read !== undefined && "entries" in read ? read.entries : undefined;
    const key = JSON.stringify(entries ?? null);
    useEffect(() => {
      if (entries !== undefined) record(sm, new Map(entries.map((e: RosterEntry) => [e.id, e.description])));
    }, [key]);
    return null;
  }
  const smContainer = happy.document.createElement("div");
  const smRoot: Root = createRoot(smContainer as unknown as Element);
  smRoot.render(createElement(LabProvider, { connection: { userId: user, bearerToken: tokens.sm, baseUrl: on.base }, children: createElement(Probe) }));

  // Teammates: the adapter's watch, read off the rows it reports.
  const stopTm = createLabAdapter(clientOf(on, tokens.tm)).watchWorkers((rows: LabWorker[]) =>
    record(tm, new Map(rows.map((row) => [row.id, row.role === "" ? null : row.role]))),
  );

  let closed = false;
  return {
    ks,
    sm,
    tm,
    tokens,
    close: () => {
      if (closed) return;
      closed = true;
      clearInterval(ksTimer);
      ksRoot.unmount();
      smRoot.unmount();
      stopTm();
    },
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const readsOf = (token: string) => rosterReads.get(token) ?? [];

async function firstAt(seen: Seen, match: (value: Shown) => boolean, from: number, withinMs: number): Promise<number | undefined> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const hit = seen.find((entry) => entry.at >= from && match(entry.value));
    if (hit !== undefined) return hit.at;
    if (Date.now() > deadline) return undefined;
    await delay(10);
  }
}

/**
 * Wait until none of `tokens` has read the roster for `quietMs`, or 15 s have
 * passed: a view that never goes quiet is graded by the idle window, not hung here.
 */
async function quiet(tokens: string[], quietMs: number): Promise<void> {
  const giveUpAt = Date.now() + 15_000;
  for (;;) {
    const last = Math.max(0, ...tokens.map((token) => readsOf(token).at(-1)?.at ?? 0));
    const wait = Math.min(last + quietMs, giveUpAt) - Date.now();
    if (wait <= 0) return;
    await delay(wait);
  }
}

async function requestDone(on: Host, requestId: string): Promise<number> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const record = await on.stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") {
      if (record.status !== "completed") throw new Error(`setup: request ${requestId} ended ${record.status}`);
      return Date.now();
    }
    if (Date.now() > deadline) throw new Error(`setup: request ${requestId} never finished`);
    await delay(5);
  }
}

/** Alice's other tab: a roster action through the roster flow, timed at its request's completion. */
async function rosterSessionOf(on: Host): Promise<{ tab: Client; sessionId: string }> {
  const tab = clientOf(on, "tok-alice-tab");
  await createWorkforceClient(tab).roster();
  const [session] = await tab.sessions.list({ flowKind: ROSTER_FLOW, userId: "alice" });
  if (session === undefined) throw new Error("setup: alice has no roster session");
  return { tab, sessionId: session.id };
}

async function act(on: Host, tab: { tab: Client; sessionId: string }, action: string, input: unknown): Promise<number> {
  const sent = await tab.tab.flow(ROSTER_FLOW).send(action, input, { sessionId: tab.sessionId });
  return requestDone(on, sent.id);
}

/** The tree with a second coordinator `WORKER.md`, built as Kitchen Sink builds its own: the installation, `agent` and `coordinator`. */
async function twoCoordinatorTree(): Promise<FlowInstance[]> {
  const root = join(SCRATCH, `two-coordinators-${RUN_STAMP}`);
  rmSync(root, { recursive: true, force: true });
  cpSync(join(workforceRoot, "teams"), join(root, "teams"), { recursive: true });
  mkdirSync(join(root, "teams/support/workers/desk"), { recursive: true });
  writeFileSync(
    join(root, "teams/support/workers/desk/WORKER.md"),
    "---\ndescription: The front desk.\nflow: coordinator\ndelegates: [support.general]\nrouting: best-fit\nfallback: support.general\n---\n\nAsk here.\n",
  );
  const read = await readWorkforce(root);
  if (read.errors.length > 0) throw new Error(`setup: ${read.errors.map((e) => e.path).join(", ")}`);
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: read.workers, workerFlows: () => flows as never });
  flows = {
    agent: defineAgentWorkerFlow({ installation }),
    [COORDINATOR_FLOW]: defineCoordinatorFlow({ installation, routeModel: ROUTE_MODEL }),
  };
  return hireWorkforce(installation);
}

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const hosts: Host[] = [];
  const closers: Array<() => void> = [];
  try {
    // ------------------------------------------------------------- a, b
    const on = await host(true);
    hosts.push(on);
    const tab = await rosterSessionOf(on);
    const alice = mountViews(on, "alice");
    const bob = mountViews(on, "bob");
    closers.push(alice.close, bob.close);
    const aliceTokens = Object.values(alice.tokens);
    const bobTokens = Object.values(bob.tokens);
    // Past the first read and any tick before the socket's first crossing frame.
    await delay(1_500);
    await quiet([...aliceTokens, ...bobTokens], FALLBACK_MS + 500);
    const ready = [alice.ks, alice.sm, alice.tm, bob.ks, bob.sm, bob.tm].every((seen) => seen.length > 0);
    if (!ready) failures.push("setup: a view never showed its first roster");
    const bobFrom = new Map(bobTokens.map((token) => [token, readsOf(token).length]));

    const changes: Array<{ what: string; run: () => Promise<number>; shows: (value: Shown) => boolean }> = [
      { what: "hire", run: () => act(on, tab, "hire", { id: "scribe", flow: "agent", description: "Takes notes" }), shows: (v) => v.get("scribe") === "Takes notes" },
      { what: "fork", run: () => act(on, tab, "fork", { from: "support.general", id: "general-mine" }), shows: (v) => v.has("general-mine") },
      { what: "edit", run: () => act(on, tab, "edit", { id: "scribe", description: "Takes better notes" }), shows: (v) => v.get("scribe") === "Takes better notes" },
      { what: "fire", run: () => act(on, tab, "fire", { id: "scribe" }), shows: (v) => !v.has("scribe") && v.has("general-mine") },
      {
        what: "hire by a worker's turn (no stream)",
        run: async () => {
          const result = (await runAction({
            flow: on.roster,
            actionName: "hire",
            input: { id: "drafter", flow: "agent", description: "Drafts" },
            userId: "alice",
            orgId: ORG,
            sessionId: tab.sessionId,
            stores: on.stores,
            runtimeConfig: {},
          })) as { error?: unknown };
          if (result.error !== undefined) throw new Error(`setup: the turn's hire failed: ${JSON.stringify(result.error)}`);
          return Date.now();
        },
        shows: (v) => v.get("drafter") === "Drafts",
      },
    ];
    const latencies: number[] = [];
    for (const change of changes) {
      const from = Date.now();
      const doneAt = await change.run();
      for (const [name, seen] of [["Kitchen Sink panel", alice.ks], ["Shift Manager roster", alice.sm], ["Teammates list", alice.tm]] as const) {
        const at = await firstAt(seen, change.shows, from, 3_000);
        if (at === undefined) failures.push(`a:within-1s: ${name} never showed the ${change.what} within 3 s`);
        else {
          const ms = Math.max(0, at - doneAt);
          latencies.push(ms);
          if (ms >= BOUND_MS) failures.push(`a:within-1s: ${name} showed the ${change.what} ${ms} ms after it completed (bound ${BOUND_MS})`);
        }
      }
    }
    const graded = tell.over("a:within-1s · each view showing each change", latencies);
    if (graded.length === changes.length * 3 && graded.every((ms) => ms < BOUND_MS)) {
      evidence.push(`a: 3 views × ${changes.length} changes shown, slowest ${Math.max(...graded)} ms after the change completed`);
    }

    await quiet(aliceTokens, 800);
    const idleFrom = new Map(aliceTokens.map((token) => [token, readsOf(token).length]));
    await delay(IDLE_MS);
    const idle = aliceTokens.map((token) => [token, readsOf(token).length - idleFrom.get(token)!] as const);
    tell.over("a:quiet · roster reads per view over 10 s idle", idle);
    const busy = idle.filter(([, n]) => n > 0);
    if (busy.length > 0) failures.push(`a:quiet: ${busy.map(([token, n]) => `${token} ${n}`).join(", ")} roster reads over ${IDLE_MS / 1000} s idle`);
    else evidence.push(`a: 0 roster reads over ${IDLE_MS / 1000} s idle in each of 3 views`);

    // b · bob's views, open through all of alice's changes.
    const bobReads = bobTokens.map((token) => [token, readsOf(token).length - bobFrom.get(token)!] as const);
    tell.over("b:other-user · bob's views' roster reads during alice's changes", bobReads);
    const bobShown = [bob.ks, bob.sm, bob.tm].flatMap((seen) => seen.map((entry) => entry.value));
    tell.over("b:other-user · bob's shown rosters", bobShown);
    const leaked = bobShown.filter((value) => ["scribe", "general-mine", "drafter"].some((id) => value.has(id)));
    if (bobReads.some(([, n]) => n > 0)) failures.push(`b:other-user: ${bobReads.map(([token, n]) => `${token} ${n}`).join(", ")} roster reads during alice's changes`);
    if (leaked.length > 0) failures.push(`b:other-user: bob's views showed alice's workers`);
    if (bobReads.every(([, n]) => n === 0) && leaked.length === 0) evidence.push("b: bob's 3 views read 0 times and never showed alice's workers");
    alice.close();
    bob.close();

    // ------------------------------------------------------------------- c
    {
      const plain = await host(false);
      hosts.push(plain);
      const plainTab = await rosterSessionOf(plain);
      const views = mountViews(plain, "alice");
      closers.push(views.close);
      await delay(1_500);
      const from = Date.now();
      const doneAt = await act(plain, plainTab, "hire", { id: "noter", flow: "agent", description: "Notes" });
      const lat: Array<[string, number | undefined]> = [];
      for (const [name, seen] of [["Kitchen Sink panel", views.ks], ["Shift Manager roster", views.sm], ["Teammates list", views.tm]] as const) {
        const at = await firstAt(seen, (v) => v.get("noter") === "Notes", from, FALLBACK_MS + BOUND_MS + 1_000);
        lat.push([name, at === undefined ? undefined : Math.max(0, at - doneAt)]);
      }
      tell.over("c:no-push · views showing the hire", lat.filter(([, ms]) => ms !== undefined));
      for (const [name, ms] of lat) {
        if (ms === undefined || ms >= FALLBACK_MS + BOUND_MS) failures.push(`c:no-push: ${name} on a host with no push: ${ms ?? "never"} ms (bound ${FALLBACK_MS + BOUND_MS})`);
      }
      if (lat.every(([, ms]) => ms !== undefined && ms < FALLBACK_MS + BOUND_MS)) evidence.push(`c: no push, the hire shown in ${lat.map(([, ms]) => ms).join("/")} ms`);
      views.close();
    }

    // ------------------------------------------------------------------- d
    {
      const registry = createFlowRegistry();
      for (const copy of await twoCoordinatorTree()) registry.register(copy);
      const router = createFlowApiRouter({
        registry,
        stores: createInMemoryStores(),
        staleSweepIntervalMs: 0,
        resolvePrincipal: () => ({ userId: "alice", orgId: ORG }),
      });
      const client = createClient({ userId: "alice", fetcher: createInProcessFetch(router) });
      const listed = await railSessions(client, createWorkforceClient(client)).sessions.list({ flowKind: COORDINATOR_FLOW, userId: "alice", include: "dispatch-runs" });
      const titles = tell.over("d:rail · the rail's coordinators", listed.map((session) => session.title ?? "")).sort();
      if (JSON.stringify(titles) !== JSON.stringify(["support.desk", "support.help"])) failures.push(`d:rail: the rail listed ${JSON.stringify(titles)}, not the tree's two coordinators`);
      else evidence.push(`d: the rail listed ${titles.join(" and ")}`);
    }
  } finally {
    for (const close of closers) close();
    for (const h of hosts) await h.handle.close();
  }
  return { failures, evidence: evidence.join(" · ") };
});
