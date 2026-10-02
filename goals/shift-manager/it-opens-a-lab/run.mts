/**
 * Goal check: Shift Manager opens a Lab it was never told about, and every screen a
 * person reaches shows what that Lab's store holds.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * Shift Manager is built with Vite into a scratch directory, then served by its own
 * start script over each goal Lab's unedited `fsdev.config.mts`: DevTeam
 * (bearer-authenticated, in-memory) and multi-seat-collab (SQLite, no auth).
 * The driver puts one row on each Lab's board through the Lab's own action
 * routes, then Chromium walks every level. What the page draws is graded
 * against two things Shift Manager never reads: the Lab's tree on disk, and the
 * Lab's store read through the HTTP routes with this script's own requests.
 *
 * Legs (each failure is tagged `[<lab>] <leg>`):
 *
 *   store     the store holds what the tree declares (a precondition)
 *   TEAMS     TEAMS equals the store's seats, each under its team
 *   PROJECTS  the workstreams equal the store's channels
 *   Board     each workstream's Board equals its board's stored rows (BR-13)
 *   Tasks     Tasks equals the stored rows that aren't done
 *   Inbox     Inbox equals the stored pending asks, or names its empty state
 *   reach     every level, tab and panel opens, and each empty one is named
 *   post      a composer post is drawn, and is in the stored transcript
 *   answer    an ask approved in its workstream's Stream is no longer pending
 *             in the store, and Inbox no longer lists it
 *
 * Controls rebuild Shift Manager with source modules swapped for a module under
 * `controls/` (a Vite `resolveId` plugin; the build fails if a swap never
 * fired):
 *
 *   static-names     seats written in from the DevTeam tree. Must fail at
 *                    "TEAMS equals the store's seats" on multi-seat-collab.
 *   optimistic-post  the composer draws its own line and sends nothing, on
 *                    both its paths (`transcript.ts` and `send.ts`). Must
 *                    fail at "the post is in the stored transcript".
 *   unanswerable-asks  every ask is marked unanswerable. Must fail at "an
 *                    answer from the Stream lands in the store" on DevTeam.
 *
 * Run:      pnpm tsx goals/shift-manager/it-opens-a-lab/run.mts
 * Control:  GOAL_CONTROL=static-names pnpm tsx goals/shift-manager/it-opens-a-lab/run.mts
 * Needs:    PLAYWRIGHT_BROWSERS_PATH pointing at a Chromium pool, or Playwright's own.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, loadFixture, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { labApi, startShiftManager, type LabApi, type ServedShiftManager } from "../../lib/shift-manager.mts";
import { Scenario, type ServedLab } from "../../multi-seat-collab/lab/run-scenario.mts";
import { readLabTree } from "../../multi-seat-collab/lab/host.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["static-names", "optimistic-post", "unanswerable-asks"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

const fixture = loadFixture<{
  line: string;
  devteam: { issue: string; text: string };
  multiSeatCollab: { goal: string; desk: string; asks: string };
}>(import.meta.url);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SHIFT_MANAGER = join(REPO_ROOT, "labs", "shift-manager");
const SCRATCH = goalTmpDir("shift-manager");

const LABS = {
  devteam: {
    config: join(REPO_ROOT, "labs", "shift-manager", "teams", "devteam", "fsdev.config.mts"),
    tree: join(REPO_ROOT, "goals", "devforce-lab", "lab", "workforce"),
  },
  "multi-seat-collab": {
    config: join(REPO_ROOT, "goals", "multi-seat-collab", "lab", "fsdev.config.mts"),
    tree: join(REPO_ROOT, "goals", "multi-seat-collab", "lab", "workforce"),
  },
} as const;
type LabName = keyof typeof LABS;

/** Stored statuses a board row is finished in. Tasks leaves these out. */
const DONE = new Set(["completed", "cancelled"]);
/** Suspension reasons that are a person being asked something. */
const PERSON_REASONS = new Set(["human_approval", "human_input"]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sorted = (values: Iterable<string>) => [...values].sort();
const same = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const diff = (want: Iterable<string>, got: Iterable<string>) => {
  const w = new Set(want);
  const g = new Set(got);
  return `missing [${[...w].filter((x) => !g.has(x)).join(", ")}], extra [${[...g].filter((x) => !w.has(x)).join(", ")}]`;
};

// ---- building Shift Manager --------------------------------------------------------

/** The control's module swap: which source files, for which module under `controls/`. */
function swapFor(control: string): { targets: string[]; with: string } | undefined {
  const lib = (file: string) => join(SHIFT_MANAGER, "src", "lib", file);
  if (control === "static-names") {
    return { targets: [lib("reads.ts")], with: join(HERE, "controls", "static-names.ts") };
  }
  if (control === "optimistic-post") {
    return { targets: [lib("transcript.ts"), lib("send.ts")], with: join(HERE, "controls", "optimistic-post.ts") };
  }
  if (control === "unanswerable-asks") {
    return { targets: [lib("reads.ts")], with: join(HERE, "controls", "unanswerable-asks.ts") };
  }
  return undefined;
}

/** Build Shift Manager's pages into a scratch directory, with the control's swap if one is set. */
async function buildShiftManager(control: string): Promise<string> {
  const outDir = join(SCRATCH, `pages-${control === "" ? "as-written" : control}`);
  const viteEntry = createRequire(join(SHIFT_MANAGER, "package.json")).resolve("vite");
  const vite = (await import(pathToFileURL(viteEntry).href)) as { build(config: Record<string, unknown>): Promise<unknown> };
  const swap = swapFor(control);
  const swapped = new Set<string>();
  const staticSeats =
    control === "static-names"
      ? (await readDeclaredRoster(LABS.devteam.tree)).workers.map((w) => ({ id: w.id, kind: String(w.declared.flow) }))
      : [];
  await vite.build({
    root: SHIFT_MANAGER,
    configFile: join(SHIFT_MANAGER, "vite.config.ts"),
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
    define: { __STATIC_SEATS__: JSON.stringify(staticSeats) },
    plugins:
      swap === undefined
        ? []
        : [
            {
              name: "goal-control-swap",
              enforce: "pre",
              async resolveId(this: any, source: string, importer: string | undefined, options: Record<string, unknown>) {
                if (importer === undefined || importer === swap.with) return null;
                const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
                const id: string | undefined = resolved?.id;
                if (id === undefined || !swap.targets.includes(id)) return null;
                swapped.add(id);
                return swap.with;
              },
            },
          ],
  });
  const missed = swap?.targets.filter((target) => !swapped.has(target)) ?? [];
  if (missed.length > 0) {
    throw new Error(`control ${control}: the build never imported ${missed.join(", ")}, so nothing was swapped there`);
  }
  return outDir;
}

// ---- serving a Lab -----------------------------------------------------------

/** Shift Manager's start script over a Lab's config, from a scratch working directory. */
const startLab = (name: LabName, pages: string, env: Record<string, string>): Promise<ServedShiftManager> =>
  startShiftManager({ scratch: SCRATCH, label: name, config: LABS[name].config, pages, env });

// ---- the store, read by this script -----------------------------------------


/** What the tree on disk declares: the oracle Shift Manager never reads. */
type Tree = {
  seats: string[];
  channels: Array<{ id: string; members: string[]; boardRefs: string[] }>;
};

async function readTree(root: string): Promise<Tree> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) throw new Error(`the tree at ${root} did not load: ${roster.problems.map((p) => p.path).join(", ")}`);
  return {
    seats: roster.workers.map((w) => w.id),
    channels: roster.channels.map((c) => ({
      id: c.id,
      members: Array.isArray(c.declared.members) ? (c.declared.members as string[]) : [],
      boardRefs: ((c.declared.boards as string[] | undefined) ?? []).map((b) => `${c.id}.${b}`),
    })),
  };
}

/** What the store holds, read through the Lab's routes by this script. */
type Store = {
  seats: string[];
  channels: Array<{ id: string; kind: string; members: string[] }>;
  /** Channel id -> every stored row on its declared boards. */
  rows: Record<string, Array<{ ref: string; id: string; status: string; title: string }>>;
  /** Suspension ids pending on a person, across the seats' sessions. */
  asks: string[];
};

async function readStore(api: LabApi, tree: Tree, userId: string): Promise<Store> {
  // The inventory, through the first channel's session, by its published key patterns.
  const host = tree.channels[0]!.id;
  const manifest = await api.get(`/sessions/${encodeURIComponent(host)}/manifest`);
  const refOf = (pattern: string) =>
    (manifest.resources as Array<{ kind: string; ref: string; pattern: string }>).find(
      (r) => r.kind === "collection" && r.pattern === pattern,
    )?.ref;
  const seatsRef = refOf("inventory/seats/*");
  const channelsRef = refOf("inventory/channels/*");
  const seats = seatsRef === undefined ? [] : (await api.collection(host, seatsRef)).map((r) => String(r.id));
  const channels =
    channelsRef === undefined
      ? []
      : (await api.collection(host, channelsRef)).map((r) => ({
          id: String(r.id),
          kind: String(r.kind),
          members: Array.isArray(r.members) ? (r.members as string[]) : [],
        }));

  const rows: Store["rows"] = {};
  for (const channel of tree.channels) {
    rows[channel.id] = [];
    for (const ref of channel.boardRefs) {
      for (const row of await api.collection(channel.id, ref)) {
        rows[channel.id]!.push({ ref, id: String(row.id), status: String(row.status), title: String(row.title ?? row.goal ?? row.id) });
      }
    }
  }

  // Pending person-asks: a suspension with no resume, on a session a seat owns.
  const listing = await api.get(`/sessions?userId=${encodeURIComponent(userId)}&include=dispatch-runs&limit=500`);
  const seatSet = new Set(seats);
  const asks: string[] = [];
  for (const session of (listing.sessions ?? []) as Array<Record<string, any>>) {
    if (!seatSet.has(String(session.flowId))) continue;
    const found = await api.items(String(session.id), ["suspension", "suspension_resume"]);
    const resumed = new Set(found.filter((i) => i.type === "suspension_resume").map((i) => String(i.suspensionId)));
    for (const item of found) {
      if (item.type === "suspension" && PERSON_REASONS.has(String(item.reason)) && !resumed.has(String(item.suspensionId))) {
        asks.push(String(item.suspensionId));
      }
    }
  }
  return { seats, channels, rows, asks };
}

// ---- putting a row on each board ---------------------------------------------

/** POST an action and wait for its request to finish. */
async function act(api: LabApi, flowId: string, sessionId: string, action: string, input: unknown, userId: string) {
  const posted = await api.call("POST", `/${encodeURIComponent(flowId)}/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(action)}`, {
    userId,
    input,
  });
  if (posted.status !== 202) throw new Error(`${action} on ${sessionId}: ${posted.status} ${JSON.stringify(posted.body)}`);
  const requestId = String(posted.body?.request?.id);
  for (let waited = 0; waited < 30_000; waited += 100) {
    const { body } = await api.call("GET", `/${encodeURIComponent(flowId)}/requests/${encodeURIComponent(requestId)}/status`);
    if (body?.status !== "in_progress") return String(body?.status);
    await sleep(100);
  }
  return "in_progress";
}

/** Wait until a channel's board holds a row, or give up. */
async function waitForRow(api: LabApi, tree: Tree, predicate: (status: string) => boolean, userId: string) {
  for (let waited = 0; waited < 30_000; waited += 250) {
    const store = await readStore(api, tree, userId);
    if (Object.values(store.rows).flat().some((r) => predicate(r.status))) return true;
    await sleep(250);
  }
  return false;
}

// ---- the page ----------------------------------------------------------------

const attr = async (page: Page, testId: string, name: string) =>
  (await page.getByTestId(testId).evaluateAll((els, n) => els.map((e) => e.getAttribute(n) ?? ""), name)) as string[];

async function open(page: Page, origin: string, path: string) {
  await page.goto(`${origin}${path}`);
  await page.getByTestId("shell").waitFor({ timeout: 20_000 });
  // The sidebar's counts read "…" until the refresh lands.
  await page.waitForFunction(() => !document.querySelector("[data-testid=nav-tasks-count]")?.textContent?.includes("…"));
}

async function visible(page: Page, testId: string, timeout = 10_000): Promise<boolean> {
  try {
    await page.getByTestId(testId).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

// ---- one Lab -----------------------------------------------------------------

async function checkLab(name: LabName, pages: string, failures: string[], evidence: string[]): Promise<void> {
  const fail = (leg: string, why: string) => failures.push(`[${name}] ${leg}: ${why}`);
  const tree = await readTree(LABS[name].tree);
  const outbox = join(SCRATCH, `${name}-work.ndjson`);
  const served = await startLab(name, pages, name === "multi-seat-collab" ? { MULTI_SEAT_COLLAB_OUTBOX: outbox } : {});
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(served.origin);
    const injected = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__ ?? null)) as {
      userId?: string;
      bearerToken?: string;
    } | null;
    const userId = injected?.userId;
    if (userId === undefined) throw new Error(`${name}: the page was handed no userId`);
    const api = labApi(served.origin, injected?.bearerToken);

    // Put a row on the board, through the Lab's own actions.
    if (name === "multi-seat-collab") {
      const labTree = await readLabTree();
      const scenario = new Scenario(
        { origin: served.origin, workDir: served.workDir, outbox, log: served.log, stop: () => served.child.kill("SIGTERM"), exited: () => served.exited } satisfies ServedLab,
        labTree,
      );
      await scenario.open();
      const filed = await scenario.file(fixture.multiSeatCollab);
      if (filed.status !== "completed") throw new Error(`${name}: the planner's file ended ${filed.status ?? filed.refusal}`);
      await scenario.drainAll();
      if (!(await waitForRow(api, tree, (s) => s === "parked", userId))) throw new Error(`${name}: the filed row never parked`);
    } else {
      const channel = tree.channels[0]!;
      const kind = (await readStore(api, tree, userId)).channels.find((c) => c.id === channel.id)?.kind;
      if (kind === undefined) throw new Error(`${name}: the inventory registers no channel ${channel.id}`);
      const status = await act(api, kind, channel.id, "post", { body: `${fixture.devteam.issue}: ${fixture.devteam.text}` }, userId);
      if (status !== "completed") throw new Error(`${name}: the filing post ended ${status}`);
      if (!(await waitForRow(api, tree, () => true, userId))) throw new Error(`${name}: the post filed no row`);
    }

    const store = await readStore(api, tree, userId);
    const storedRows = Object.values(store.rows).flat();
    const key = (r: { ref: string; id: string }) => `${r.ref}/${r.id}`;

    // ---- store: the store holds what the tree declares --------------------
    if (!same(store.seats, tree.seats)) fail("store", `the inventory's seats are not the tree's: ${diff(tree.seats, store.seats)}`);
    if (!same(store.channels.map((c) => c.id), tree.channels.map((c) => c.id))) {
      fail("store", `the inventory's channels are not the tree's: ${diff(tree.channels.map((c) => c.id), store.channels.map((c) => c.id))}`);
    }
    if (storedRows.length === 0) fail("store", "no board holds a row, so the board legs would grade nothing");

    await open(page, served.origin, "/inbox");

    // ---- TEAMS: one status square per seat, under its team's row -------------
    const shownSeats = await attr(page, "worker", "data-seat-id");
    if (!same(shownSeats, store.seats)) fail("TEAMS equals the store's seats", diff(store.seats, shownSeats));
    for (const team of await attr(page, "team", "data-team")) {
      const under = await page.locator(`[data-testid=team][data-team="${team}"] [data-testid=worker]`).evaluateAll((els) =>
        els.map((e) => e.getAttribute("data-seat-id") ?? ""),
      );
      // A seat with no team (an org seat) sits in the Staff row.
      const want = store.seats.filter((s) => (s.includes(".") ? s.split(".")[0] : "Staff") === team);
      if (!same(under, want)) fail("TEAMS equals the store's seats", `team ${team} lists ${diff(want, under)}`);
    }

    // ---- PROJECTS ------------------------------------------------------------
    const shownStreams = (await page.locator("[data-testid^=nav-workstream-]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-testid") ?? ""),
    )).map((t) => t.slice("nav-workstream-".length));
    if (!same(shownStreams, store.channels.map((c) => c.id))) {
      fail("PROJECTS equals the store's channels", diff(store.channels.map((c) => c.id), shownStreams));
    }

    // ---- Inbox ---------------------------------------------------------------
    const inboxItems = await page.getByTestId("inbox-item").count();
    if (store.asks.length === 0) {
      if (!(await visible(page, "inbox-empty", 3_000))) fail("Inbox equals the store's pending asks", "no ask is pending and the empty state is not named");
    } else if (inboxItems !== store.asks.length) {
      fail("Inbox equals the store's pending asks", `${inboxItems} listed, ${store.asks.length} pending in the store`);
    }
    evidence.push(`${name}: inbox ${inboxItems} listed / ${store.asks.length} pending`);

    // ---- Tasks ---------------------------------------------------------------
    await page.getByTestId("nav-tasks").click();
    await page.getByTestId("tasks").waitFor();
    const open_ = storedRows.filter((r) => !DONE.has(r.status)).map(key);
    for (const grouping of ["state", "worker", "stream"]) {
      await page.locator(`[role=tab][data-grouping=${grouping}]`).click();
      await page.locator(`[role=tab][data-grouping=${grouping}][aria-selected=true]`).waitFor();
      if (open_.length === 0) {
        if (!(await visible(page, "tasks-empty", 3_000))) fail("Tasks equals the store's open rows", "no open row and the empty state is not named");
        continue;
      }
      const shown = (await page.getByTestId("task-row").evaluateAll((els) =>
        els.map((e) => `${e.getAttribute("data-board-ref")}/${e.getAttribute("data-task-id")}`),
      )) as string[];
      if (!same(shown, open_)) fail("Tasks equals the store's open rows", `grouped by ${grouping}: ${diff(open_, shown)}`);
    }

    // ---- Chief of Staff, where the Lab lands -----------------------------------
    await page.getByTestId("nav-cos").click();
    if (!(await visible(page, "cos"))) fail("reach", "Chief of Staff does not open");
    if (!(await visible(page, "cos-summary"))) fail("reach", "Chief of Staff draws no shift summary");
    if (!(await visible(page, "cos-panel"))) fail("reach", "Chief of Staff has no right panel");

    // ---- Project level -------------------------------------------------------
    await page.getByTestId("projects-heading").click();
    for (const tab of ["stream", "board", "workstreams", "brief"]) {
      await page.locator(`[role=tab][data-tab=${tab}]`).click();
      if (!(await visible(page, `project-${tab}-empty`))) fail("reach", `the project's ${tab} tab shows no named empty state`);
    }

    // ---- each workstream -----------------------------------------------------
    for (const channel of tree.channels) {
      await page.getByTestId(`nav-workstream-${channel.id}`).click();
      await page.locator(`[data-testid=workstream][data-channel-id="${channel.id}"]`).waitFor();
      if (!(await visible(page, "workstream-panel"))) fail("reach", `${channel.id} has no right panel`);
      const members = await attr(page, "panel-member", "data-seat-id");
      if (!same(members, channel.members)) fail("PROJECTS equals the store's channels", `${channel.id}'s panel team: ${diff(channel.members, members)}`);

      await page.locator("[role=tab][data-tab=board]").click();
      const rowsHere = (store.rows[channel.id] ?? []).map(key);
      if (channel.boardRefs.length === 0) {
        if (!(await visible(page, "board-none"))) fail("reach", `${channel.id} attaches no board and its Board tab doesn't say so`);
      } else if (!(await visible(page, "board"))) {
        fail("Board equals the store's rows", `${channel.id}'s Board tab shows no board`);
      } else {
        const cards = (await page.getByTestId("board-card").evaluateAll((els) =>
          els.map((e) => `${e.getAttribute("data-board-ref")}/${e.getAttribute("data-task-id")}`),
        )) as string[];
        if (!same(cards, rowsHere)) fail("Board equals the store's rows", `${channel.id}: ${diff(rowsHere, cards)}`);
        for (const row of store.rows[channel.id] ?? []) {
          const card = page.locator(`[data-testid=board-card][data-task-id="${row.id}"]`);
          if (DONE.has(row.status)) {
            // A done row is one line in DONE, its id and title (v2:547); it carries its stored status.
            const inDone = await page.locator(`[data-testid=board-column][data-column=DONE] [data-testid=board-card][data-task-id="${row.id}"]`).count();
            const status = await card.getAttribute("data-status");
            if (inDone !== 1 || status !== row.status) fail("Board equals the store's rows", `${row.id} is ${inDone === 1 ? `in DONE as "${status}"` : "not in DONE"}, stored "${row.status}"`);
          } else {
            const status = await card.locator("[data-testid=board-card-status]").textContent();
            if (status !== row.status) fail("Board equals the store's rows", `${row.id} shows "${status}", stored "${row.status}"`);
          }
        }
      }

      await page.locator("[role=tab][data-tab=brief]").click();
      if (!(await visible(page, "brief", 5_000)) && !(await visible(page, "empty-state", 1_000))) {
        fail("reach", `${channel.id}'s Brief shows neither a charter nor a named empty state`);
      }
      await page.locator("[role=tab][data-tab=results]").click();
      if (!(await visible(page, "empty-state"))) fail("reach", `${channel.id}'s Results shows no named empty state`);

      // The task level, from this workstream's first card.
      const first = store.rows[channel.id]?.[0];
      if (first !== undefined) {
        await page.locator("[role=tab][data-tab=board]").click();
        await page.locator(`[data-testid=board-card][data-task-id="${first.id}"]`).click();
        await page.getByTestId("task-frame").waitFor();
        const title = await page.getByTestId("task-title").textContent();
        if (title !== first.title) fail("Board equals the store's rows", `the task frame titles ${first.id} "${title}", stored "${first.title}"`);
        if (!(await visible(page, "task-panel-slot"))) fail("reach", `the task frame for ${first.id} has no panel slot`);
        for (const tab of ["session", "diff", "checks", "brief"]) {
          await page.locator(`[role=tab][data-tab=${tab}]`).click();
          if (!(await visible(page, "task-slot"))) fail("reach", `the task frame's ${tab} tab shows nothing`);
        }
      }
    }

    // ---- post: the composer, on the first workstream -------------------------
    const channel = tree.channels[0]!;
    const line = `${fixture.line} (${name} ${RUN_STAMP})`;
    await open(page, served.origin, `/w/${encodeURIComponent(channel.id)}/stream`);
    await page.getByTestId("composer-input").fill(line);
    await page.getByTestId("composer-send").click();
    const drawn = page.getByTestId("transcript-line-body").filter({ hasText: line });
    try {
      await drawn.first().waitFor({ timeout: 30_000 });
    } catch {
      fail("the post appears on screen", `"${line}" was never drawn (${(await page.getByTestId("composer-status").textContent()) ?? ""})`);
    }
    const kept = (await api.items(channel.id, ["component"])).filter(
      (i) => i.component === "channel-post" && i.data?.body === line,
    );
    if (kept.length !== 1) fail("the post is in the stored transcript", `the channel's session holds ${kept.length} copies of "${line}"`);
    // And it survives a reload, which only a stored line does.
    await open(page, served.origin, `/w/${encodeURIComponent(channel.id)}/stream`);
    if (!(await visible(page, "transcript-line-body"))) fail("the post is in the stored transcript", "after a reload the transcript is empty");
    else if ((await drawn.count()) !== 1) fail("the post is in the stored transcript", `after a reload "${line}" is drawn ${await drawn.count()} times`);

    // ---- answer: an ask approved in its workstream's Stream is resumed in the store, and leaves Inbox ----
    // A pending ask sits in its channel's Stream, inline at its time (BR-16).
    // A Lab holding any pending ask must offer at least one to answer there:
    // pick the first whose card has an enabled Approve. None at all is a failure.
    let answered = "no ask to answer";
    if (store.asks.length > 0) {
      let picked: string | null = null;
      for (const channel of tree.channels) {
        if (picked !== null) break;
        await open(page, served.origin, `/w/${encodeURIComponent(channel.id)}/stream`);
        await page.getByTestId("feed-ask").first().waitFor({ timeout: 5_000 }).catch(() => undefined);
        const asks = page.getByTestId("feed-ask");
        for (let i = 0; i < (await asks.count()) && picked === null; i += 1) {
          const approve = asks.nth(i).getByRole("button", { name: "Approve" });
          if ((await approve.count()) > 0 && !(await approve.isDisabled())) {
            picked = await asks.nth(i).getAttribute("data-suspension-id");
            await approve.click();
          }
        }
      }
      if (picked === null) {
        fail("an answer from the Stream lands in the store", `${store.asks.length} ask(s) pending and no workstream's Stream offers an answer on any`);
        answered = "no ask answerable";
      } else {
        let left = store.asks;
        for (let waited = 0; waited < 20_000 && left.includes(picked); waited += 250) {
          await sleep(250);
          left = (await readStore(api, tree, userId)).asks;
        }
        if (left.includes(picked) || left.length !== store.asks.length - 1) {
          fail("an answer from the Stream lands in the store", `${store.asks.length} pending before Approve, ${left.length} after, the approved one ${left.includes(picked) ? "still" : "no longer"} pending`);
        }
        // The answer clears it from Inbox too: both draw the same pending asks.
        await open(page, served.origin, "/inbox");
        const listed = await page.locator(`[data-testid=inbox-item][data-suspension-id="${picked}"]`).count();
        if (listed !== 0) fail("an answer from the Stream leaves Inbox", `the ask approved in the Stream is still listed in Inbox`);
        answered = `approved 1 of ${store.asks.length} in the Stream, ${left.length} left in the store, ${listed} listed in Inbox`;
      }
    }

    if (pageErrors.length > 0) fail("reach", `the page threw: ${pageErrors.join(" | ")}`);
    evidence.push(
      `${name}: ${store.seats.length} seats, ${store.channels.length} channels, ${storedRows.length} row(s) [${storedRows.map((r) => r.status).join(", ")}], post kept ${kept.length}, ${answered}`,
    );
  } finally {
    await browser.close();
    served.child.kill("SIGTERM");
    await served.exited;
  }
}

await runGoal(async () => {
  const pages = await buildShiftManager(CONTROL);
  const failures: string[] = [];
  const evidence: string[] = [];
  for (const name of Object.keys(LABS) as LabName[]) {
    await checkLab(name, pages, failures, evidence);
  }
  return {
    failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
    evidence: `Shift Manager built with Vite and served by its start script over both goal Labs; every level walked in Chromium and graded against each tree on disk and each store read through the Lab's routes. ${evidence.join("; ")}`,
  };
});
