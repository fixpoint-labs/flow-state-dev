/**
 * live read › one loop, every watcher (FIX-2551).
 *
 * One `serve()` host on a bound port with Kitchen Sink's workforce tree and
 * claude-code-style's pins resource, on the crossing double, so push covers
 * every topic and no timer runs. Five watchers, each through its own caller's
 * code, each on its own credential so its reads are counted at its fetcher
 * (requests the server answers, never `read` calls against a fake):
 *
 *   rp  React's `Roster` panel, live, rendered by react-dom over happy-dom, read off the rows it draws
 *   rw  Workforce's `watchRoster`, read off what it reports (it, and tm, read the roster view)
 *   sm  Shift Manager's snapshot, under its real `LabProvider`, counted per snapshot read
 *   tm  the Teammates lab's `watchWorkers`
 *   cc  the claude-code-style lab's `watchPins`
 *
 * Alice's other tab writes as an app does, with no roster session: hires
 * through the workforce client, on the roster flow the workers collection's
 * `runBy` names, and pins through the pins resource's default write
 * (FIX-2624). Only the React panel, which reads a session's collection, is
 * handed a roster session the page makes for it.
 *
 * It writes:
 *
 *   a  — a burst: 50 hires (the roster) and 50 pins (your user resource), each
 *        landing while every watcher's read is held in flight. Each watcher
 *        of what changed reads at most twice for its burst; each watcher of
 *        the other makes 0 reads; once quiet, each shows what the store holds.
 *   b  — one failed read: each watcher's next read answers 503, one write
 *        wakes it (a hire, then a pin), and no notice follows. Each shows
 *        the change within 2 s.
 *
 * Controls (each runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=no-coalesce   every notice reads at once: a:burst must FAIL.
 *   GOAL_CONTROL=rule-says-no  the path rule rules every path out: a:equals-store must FAIL.
 *   GOAL_CONTROL=no-retry      a failed read waits for the next change: b:recovers must FAIL.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import * as React from "react";
import { createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createClient, type Client } from "@flow-state-dev/client";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { Roster } from "@flow-state-dev/react/workforce";
import { createWorkforceClient, PROJECTS_FLOW, ROSTER_FLOW, rosterView, type RosterEntry } from "@flow-state-dev/workforce/browser";
import { crossingBus } from "../../lib/crossing-bus.mts";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, kitFlows, modulePatchEnv, type ModulePatch } from "../../lib/index.mts";
import { kitchenSinkWorkforce } from "../../../apps/kitchen-sink/lib/workforce-kit.ts";
import { LabProvider, useLab } from "../../../packages/shift-manager/src/lib/lab-data.tsx";
import { createLabAdapter, type LabWorker } from "../../../labs/teammates/src/adapter.ts";
import { createWiredLab } from "../../../labs/claude-code-style/src/adapter.ts";
import { defineFlow } from "@flow-state-dev/core";
import { labPins } from "../../../labs/claude-code-style/flows/user-marks.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("live-read-one-loop");
const BURST = 50;
const MAX_READS_PER_BURST = 2;
const RECOVER_MS = 2_000;
/** Leg b's window closes once no notice has reached a watcher for this long... */
const QUIET_MS = 200;
/** ...or this long after the write, whichever comes first. */
const CLOSE_CAP_MS = 3_000;
const ORG = "acme";

const PATCHES: Record<string, ModulePatch[]> = {
  // No queue: every notice heard starts a read of its own.
  "no-coalesce": [{ module: "packages/client/src/live/coalesce.ts", from: String.raw`if \(!running\) return run\(notice\);`, to: "return run(notice);" }],
  // The path rule says no to every path, even with nothing ruled out.
  "rule-says-no": [{ module: "packages/client/src/live/paths.ts", from: String.raw`if \(roots === undefined\) return true;`, to: "return false;" }],
  // A failed read schedules nothing: it waits for the next change.
  "no-retry": [
    {
      module: "packages/client/src/live/live-read.ts",
      from: String.raw`retry = setTimeout\(\(\) => reads\.request\(null\), backoffDelay\(failures\)\);`,
      to: "void backoffDelay;",
    },
  ],
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  mkdirSync(SCRATCH, { recursive: true });
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

const happy = new Window();
// tsx compiles the apps' `.tsx` files with the classic JSX transform, which calls the global `React`.
Object.assign(globalThis, { window: happy, document: happy.document, IS_REACT_ACT_ENVIRONMENT: false, React });

// ---------------------------------------------------------------------------
// Each watcher's credential, and the one request that is its read
// ---------------------------------------------------------------------------

type Watcher = "rp" | "rw" | "sm" | "tm" | "cc";
const WATCHERS: readonly Watcher[] = ["rp", "rw", "sm", "tm", "cc"];
const ROSTER_WATCHERS: readonly Watcher[] = ["rp", "rw", "sm", "tm"];
const TOKENS: Record<string, string> = { "tok-rp": "alice", "tok-rw": "alice", "tok-sm": "alice", "tok-tm": "alice", "tok-cc": "alice", "tok-tab": "alice" };
const tokenOf = (w: Watcher) => `tok-${w}`;

/**
 * Whether `url` is one read of what watcher `w` shows: the panel's read of the roster's own
 * collection, a roster view call (each roster watch follows the view, FIX-2623), a snapshot's
 * first request, the pins read.
 */
function isReadOf(w: Watcher, url: string): boolean {
  if (w === "sm") return url.includes("/sessions") && url.includes("dispatch-runs");
  if (w === "cc") return url.includes("/resources/user/lab-pins");
  if (w === "rp") return url.includes("workforceWorkers") && !url.includes("workforceStandardWorkers");
  return url.includes(`/api/flows/${rosterView.flow}/views/${rosterView.view}`);
}

const reads = new Map<Watcher, number[]>(WATCHERS.map((w) => [w, []]));
/** While set, each watcher's read is answered only once `release` runs. */
let held: Promise<void> | undefined;
let release: () => void = () => {};
/** Watchers whose every read answers 503, while a write's notices land. */
const failing = new Set<Watcher>();
/** How many reads each watcher had answered 503 while it was failing. */
const failedReads = new Map<Watcher, number>();
/** When each notice frame reached each watcher's socket. */
const notices = new Map<Watcher, number[]>(WATCHERS.map((w) => [w, []]));
/** The watcher each push ticket was minted for, from the mint's answer at its fetcher. */
const ticketOf = new Map<string, Watcher>();

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const auth = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("authorization") ?? "";
  const w = WATCHERS.find((candidate) => auth === `Bearer ${tokenOf(candidate)}`);
  if (w !== undefined && isReadOf(w, url)) {
    reads.get(w)!.push(Date.now());
    if (failing.has(w)) {
      failedReads.set(w, (failedReads.get(w) ?? 0) + 1);
      return new Response(JSON.stringify({ error: "down" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    if (held !== undefined) await held;
  }
  if (w !== undefined && url.includes("/stream")) {
    const response = await realFetch(input, init);
    const ticket = (await response.clone().json().catch(() => undefined)) as { ticket?: unknown } | undefined;
    if (typeof ticket?.ticket === "string") ticketOf.set(ticket.ticket, w);
    return response;
  }
  return realFetch(input, init);
};

// Each watcher's socket, known by the ticket it subscribes with: every notice frame it receives
// is recorded, so leg b can check that no notice reached a watcher after its window closed.
const realSend = WebSocket.prototype.send;
const tagged = new WeakSet<WebSocket>();
WebSocket.prototype.send = function (this: WebSocket, data: Parameters<WebSocket["send"]>[0]) {
  const sent = typeof data === "string" ? (JSON.parse(data) as { type?: unknown; ticket?: unknown }) : undefined;
  const w = sent?.type === "subscribe" && typeof sent.ticket === "string" ? ticketOf.get(sent.ticket) : undefined;
  if (w !== undefined && !tagged.has(this)) {
    tagged.add(this);
    this.addEventListener("message", (event) => {
      const frame = JSON.parse(String((event as MessageEvent).data)) as { type?: unknown };
      if (frame.type === "notice") notices.get(w)!.push(Date.now());
    });
  }
  return realSend.call(this, data);
};

// ---------------------------------------------------------------------------
// The host and the watchers
// ---------------------------------------------------------------------------

type Host = { handle: ServeHandle; base: string; stores: StoreRegistry };

async function host(): Promise<Host> {
  const copies = await kitFlows([kitchenSinkWorkforce()]);
  const registry = createFlowRegistry();
  for (const copy of copies) registry.register(copy);
  // The lab's pins: a user resource the host declares, written through the default write flow.
  registry.register(defineFlow({ kind: PROJECTS_FLOW, resources: { labPins }, actions: {} } as never)() as never);
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
  const handle = await serve(router, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200, push: true });
  return { handle, base: `http://127.0.0.1:${handle.port}`, stores };
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

/** What each watcher shows now, with when it last changed. */
type Shown = { ids: string[]; at: number };
const shown = new Map<Watcher, Shown>(WATCHERS.map((w) => [w, { ids: [], at: 0 }]));
const show = (w: Watcher, ids: readonly string[]) => {
  const sorted = [...ids].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(shown.get(w)!.ids)) shown.set(w, { ids: sorted, at: Date.now() });
};
/** How many rows the React panel's last read drew. */
let rpCount = 0;
/** When the snapshot last landed a read (it shows no roster rows, so a landed read is what it shows). */
let snapshotReadAt = 0;

function mount(on: Host, rosterSession: string): () => void {
  // React: the live Roster panel, read off the rows it draws.
  const rpContainer = happy.document.createElement("div");
  const rpRoot: Root = createRoot(rpContainer as unknown as Element);
  rpRoot.render(createElement(Roster, { sessionId: rosterSession, collectionRef: "workforceWorkers", client: clientOf(on, tokenOf("rp")), live: true } as never));
  // The panel draws the org inventory's row shape; the user's roster rows it read are drawn as unreadable
  // ones, counted. So it shows how many rows its last read held: one per worker.
  const rpTimer = setInterval(() => {
    if (rpContainer.querySelector("[data-panel='roster']") === null) return;
    const drawn = rpContainer.querySelectorAll("[data-worker-id]").length;
    const unreadable = Number(rpContainer.querySelector("[data-roster-problems]")?.getAttribute("data-roster-problems") ?? 0);
    rpCount = drawn + unreadable;
  }, 5);

  // Workforce: the roster watch, read off what it reports.
  const stopRw = createWorkforceClient(clientOf(on, tokenOf("rw"))).watchRoster((entries: RosterEntry[]) =>
    show("rw", entries.filter((e) => !e.standard).map((e) => e.id)),
  );

  // Shift Manager: the snapshot under its real provider.
  function Probe() {
    const { snapshot } = useLab();
    const readAt = snapshot !== undefined && "readAt" in snapshot ? snapshot.readAt : undefined;
    useEffect(() => {
      if (readAt !== undefined) snapshotReadAt = Date.now();
    }, [readAt]);
    return null;
  }
  const smContainer = happy.document.createElement("div");
  const smRoot: Root = createRoot(smContainer as unknown as Element);
  smRoot.render(createElement(LabProvider, { connection: { userId: "alice", bearerToken: tokenOf("sm"), baseUrl: on.base }, children: createElement(Probe) }));

  // Teammates: its roster screen's watch.
  const stopTm = createLabAdapter(clientOf(on, tokenOf("tm"))).watchWorkers((rows: LabWorker[]) => show("tm", rows.filter((row) => row.own === true).map((row) => row.id)));

  // claude-code-style: your pins.
  const stopCc = createWiredLab(clientOf(on, tokenOf("cc"))).watchPins((ids) => show("cc", ids));

  return () => {
    clearInterval(rpTimer);
    rpRoot.unmount();
    smRoot.unmount();
    stopRw();
    stopTm();
    stopCc();
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wait until no watcher has read for `quietMs` (15 s at most). */
async function quiet(quietMs = 400): Promise<void> {
  const giveUpAt = Date.now() + 15_000;
  for (;;) {
    const last = Math.max(0, ...WATCHERS.map((w) => reads.get(w)!.at(-1) ?? 0));
    const wait = Math.min(last + quietMs, giveUpAt) - Date.now();
    if (wait <= 0) return;
    await delay(wait);
  }
}

const readsSince = (w: Watcher, from: number) => reads.get(w)!.filter((at) => at >= from).length;

async function waitFor(check: () => boolean, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await delay(10);
  }
  return true;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

const on = await host();
const tab = clientOf(on, "tok-tab");
const tabWorkforce = createWorkforceClient(tab);
// The React panel reads a session's collection, and no read makes a session any more (FIX-2624),
// so the page makes the roster session it hands the panel, as a session-addressed read does today.
const rosterSession = await tab.flow(ROSTER_FLOW).createSession();
// A hire as an app writes one: through the workforce client, on the roster flow the workers'
// `runBy` names, in alice's write session.
const hire = (id: string) => tabWorkforce.hire({ id, flow: "agent", description: id });
const pin = (id: string) => tab.resource(labPins).update((s) => ({ pinned: [...s.pinned, id] }));

const unmount = mount(on, rosterSession.id);
try {
  const mounted = await waitFor(() => ROSTER_WATCHERS.every((w) => w === "sm" ? snapshotReadAt > 0 : reads.get(w)!.length > 0) && reads.get("cc")!.length > 0, 15_000);
  if (!mounted) throw new Error(`setup: not every watcher read on open (${WATCHERS.map((w) => `${w}:${reads.get(w)!.length}`).join(" ")})`);
  await quiet();

  // a — two bursts, each landing while every read is held in flight.
  const burst = async (what: string, write: (i: number) => Promise<unknown>) => {
    held = new Promise<void>((resolve) => (release = resolve));
    const from = Date.now();
    for (let i = 0; i < BURST; i++) await write(i);
    const written = Date.now();
    // Give the last notice time to reach every socket before the reads land.
    await delay(200);
    release();
    held = undefined;
    // The held reads land now, and each queued one starts after: quiet is measured from here.
    await delay(400);
    await quiet();
    const done = Date.now();
    return { what, from, written, done };
  };
  const roster = await burst("roster", (i) => hire(`w${String(i).padStart(2, "0")}`));
  const smAfterRoster = snapshotReadAt;
  const pins = await burst("pins", (i) => pin(`t${String(i).padStart(2, "0")}`));

  for (const w of ROSTER_WATCHERS) {
    const n = reads.get(w)!.filter((at) => at >= roster.from && at < pins.from).length;
    check(`a:burst ${w}`, n >= 1 && n <= MAX_READS_PER_BURST, `${n} reads for ${BURST} hires`);
    const m = reads.get(w)!.filter((at) => at >= pins.from).length;
    // A pin runs in its writer's write session, which no listing shows (FIX-2624), so the
    // snapshot has nothing of it to read: the pins burst is unrelated to it too.
    check(`a:unrelated ${w}`, m === 0, `${m} reads for ${BURST} pins${m > 0 ? ` (at +${reads.get(w)!.filter((at) => at >= pins.from).map((at) => at - pins.from).join(", +")} ms; burst took ${pins.done - pins.from} ms)` : ""}`);
  }
  {
    const n = readsSince("cc", pins.from);
    check("a:burst cc", n >= 1 && n <= MAX_READS_PER_BURST, `${n} reads for ${BURST} pins`);
    const m = reads.get("cc")!.filter((at) => at >= roster.from && at < pins.from).length;
    check("a:unrelated cc", m === 0, `${m} reads for ${BURST} hires`);
  }

  const storeRoster = (await tabWorkforce.roster()).filter((e) => !e.standard).map((e) => e.id).sort();
  const storePins = [...(await tab.resource(labPins).state()).pinned].sort();
  check("a:equals-store rp", rpCount === storeRoster.length, `drew ${rpCount} rows for ${storeRoster.length} workers`);
  for (const w of ["rw", "tm"] as const) {
    const ids = shown.get(w)!.ids;
    check(`a:equals-store ${w}`, JSON.stringify(ids) === JSON.stringify(storeRoster), `shows ${ids.length} of ${storeRoster.length} workers`);
  }
  check("a:equals-store sm", smAfterRoster > roster.written, `its last read before the pins landed ${smAfterRoster - roster.written} ms after the last hire`);
  check("a:equals-store cc", JSON.stringify(shown.get("cc")!.ids) === JSON.stringify(storePins), `shows ${shown.get("cc")!.ids.length} of ${storePins.length} pins`);

  // b — one failed read each, woken by one write, and then no notice: the roster's watchers by a
  // hire, then the pins' watcher by a pin.
  const recover = async (who: readonly Watcher[], write: () => Promise<unknown>, shows: (w: Watcher) => boolean) => {
    for (const w of who) {
      failing.add(w);
      failedReads.set(w, 0);
    }
    const from = Date.now();
    await write();
    // Every read fails until the write's notices have stopped reaching the watchers (one write
    // sends several, and a watcher may hear them all): QUIET_MS with none, at most CLOSE_CAP_MS.
    // After the close only a retry can show the change; a notice after it fails the watcher.
    const writtenAt = Date.now();
    const capAt = writtenAt + CLOSE_CAP_MS;
    for (;;) {
      const last = Math.max(writtenAt, ...who.map((w) => notices.get(w)!.at(-1) ?? 0));
      const wait = Math.min(last + QUIET_MS, capAt) - Date.now();
      if (wait <= 0) break;
      await delay(wait);
    }
    for (const w of who) failing.delete(w);
    const closedAt = Date.now();
    const quietAtClose = who.every((w) => (notices.get(w)!.at(-1) ?? 0) <= closedAt - QUIET_MS);
    const shownAt = new Map<Watcher, number>();
    await waitFor(() => {
      for (const w of who) if (!shownAt.has(w) && shows(w)) shownAt.set(w, Date.now());
      return shownAt.size === who.length;
    }, RECOVER_MS);
    // Graded per watcher, so a control that leaves one watcher green shows which.
    for (const w of who) {
      const n = failedReads.get(w) ?? 0;
      const heard = notices.get(w)!.filter((at) => at >= from && at <= closedAt).length;
      check(
        `b:failed ${w}`,
        n > 0 && heard > 0,
        `${n} read(s) answered 503 while ${heard} notice(s) reached it; window closed ${closedAt - writtenAt} ms after the write${quietAtClose ? "" : " at the cap, not quiet"}`,
      );
      const at = shownAt.get(w);
      const late = notices.get(w)!.filter((t) => t > closedAt && t <= (at ?? Date.now())).length;
      check(
        `b:recovers ${w}`,
        at !== undefined && late === 0,
        at === undefined
          ? `not within ${RECOVER_MS} ms of the window's close`
          : late > 0
            ? `${late} notice(s) reached it after the window closed, before it showed the change`
            : `showed the change ${at - closedAt} ms after the window closed, with no notice after it`,
      );
    }
  };


  const smBefore = snapshotReadAt;
  await recover(ROSTER_WATCHERS, () => hire("after-failure"), (w) =>
    w === "sm" ? snapshotReadAt > smBefore : w === "rp" ? rpCount === storeRoster.length + 1 : shown.get(w)!.ids.includes("after-failure"),
  );
  await recover(["cc"], () => pin("after-failure"), () => shown.get("cc")!.ids.includes("after-failure"));
} finally {
  unmount();
  await on.handle.close();
}

console.log(failures.length === 0 ? "VERDICT: PASS" : `VERDICT: FAIL (${failures.join(", ")})`);
process.exit(failures.length === 0 ? 0 : 1);
