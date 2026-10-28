/**
 * What every leg of this goal does the way a person does it, and what it
 * reads back from the Lab's store to grade it.
 *
 * A person asks the Shift Coordinator in Shift Manager's Shift Coordinator view,
 * answers asks in Inbox, posts in a project's Stream or a workstream's
 * composer, and reads PROJECTS and TEAMS in the sidebar. What happened is read
 * through the Lab's routes as a verified user ({@link labRoutes}), never from
 * Shift Manager's own state. Every graded turn runs once (D2): nothing here
 * retries a turn except one that hit a provider error, which is reported.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Browser, Page } from "playwright";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { PROJECTS_FLOW } from "../../../packages/shift-manager/teams/devteam/host.mts";
import {
  labRoutes,
  openShiftManager,
  personPage,
  startShiftManager,
  type LabRoutes,
  type LabUser,
  type ServedShiftManager,
  type StoredItem,
} from "../../lib/shift-manager.mts";

/** The seat Shift Manager and the Lab find the Shift Coordinator by. */
export const SHIFT_COORDINATOR = "shift-coordinator";
/** The flow a person's roster is read through (Workforce's roster flow). */
const ROSTER_FLOW = "workforce-roster";
/** Where a person's own workers are stored: one row per worker, in their scope. */
const WORKERS_PATTERN = "workforce/workers/*";
/** How long one turn of the Shift Coordinator may take: a real model answers it. */
export const TURN_MS = 240_000;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const hex = (n = 3) => randomBytes(n).toString("hex");
const sorted = (values: Iterable<string>) => [...values].sort();
export const same = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

// ---- the record a run keeps ---------------------------------------------------

export type Verdict = "PASS" | "FAIL" | "BLOCKED";

/** One Shift Coordinator turn, as the report quotes it. */
export interface Turn {
  step: string;
  words: string;
  sessionId: string | null;
  requestId: string | null;
  status: string;
  tools: Array<{ itemId: string; name: string; args: string; ok: boolean; output: string }>;
  reply: string;
  onScreen: boolean;
  /** A provider error re-ran this turn once (QR-8). */
  providerRetry?: string;
  /** What the composer told the person when it reported anything but delivered for a line the store holds. */
  composerSaid?: string;
}

/** Every step's verdict and what it was graded on, for one run of legs (plain, or under a control). */
export class RunRecord {
  readonly steps = new Map<string, { verdict: Verdict; notes: string[] }>();
  readonly turns: Turn[] = [];
  readonly boots: Array<{ label: string; store: string; config: string }> = [];
  readonly screenshots: string[] = [];
  constructor(readonly label: string, readonly shots: string) {}

  private entry(step: string) {
    let e = this.steps.get(step);
    if (e === undefined) this.steps.set(step, (e = { verdict: "PASS", notes: [] }));
    return e;
  }
  /** A failure of `step`. The step stays FAIL whatever passes after it. */
  fail(step: string, why: string): void {
    const e = this.entry(step);
    if (e.verdict !== "BLOCKED") e.verdict = "FAIL";
    e.notes.push(`FAIL: ${why}`);
  }
  /** What `step` showed when it held. */
  saw(step: string, what: string): void {
    this.entry(step).notes.push(what);
  }
  block(step: string, why: string): void {
    const e = this.entry(step);
    e.verdict = "BLOCKED";
    e.notes.push(`BLOCKED: ${why}`);
  }
  verdict(step: string): Verdict | undefined {
    return this.steps.get(step)?.verdict;
  }
  async shot(page: Page, name: string): Promise<void> {
    const path = join(this.shots, `${this.label}-${name}.png`);
    await page.screenshot({ path, fullPage: false }).catch(() => undefined);
    this.screenshots.push(path);
  }
}

// ---- a Lab this run serves --------------------------------------------------------

/** The Lab's three named people (the DevTeam host's `LAB_USERS`). */
export type People = { owner: LabUser; member: LabUser; outsider: LabUser };

/** A Lab being served, the people who use it, and a page per person. */
export class World {
  served!: ServedShiftManager;
  routes!: { owner: LabRoutes; member: LabRoutes; outsider: LabRoutes };
  page!: Page;
  pageErrors: string[] = [];
  /** The profile config the Lab is served from now: the commit's, or a scratch copy's. */
  config: string;
  private closePage: (() => Promise<void>) | undefined;
  constructor(
    readonly browser: Browser,
    readonly people: People,
    readonly lab: { config: string; pages: string; scratch: string; store: string; env?: Record<string, string>; root?: string; tsx?: string },
    readonly record: RunRecord,
  ) {
    this.config = lab.config;
  }

  /** Start (or restart, on the same store) the Lab, and open the owner's page. Records the boot. */
  async boot(label: string, config = this.lab.config): Promise<void> {
    this.config = config;
    this.served = await startShiftManager({
      scratch: this.lab.scratch,
      label: label.replace(/\s+/g, "-"),
      config,
      pages: this.lab.pages,
      env: { DEVTEAM_STORE: this.lab.store, ...(this.lab.env ?? {}) },
      timeoutMs: 120_000,
      ...(this.lab.root === undefined ? {} : { root: this.lab.root }),
      ...(this.lab.tsx === undefined ? {} : { tsx: this.lab.tsx }),
    });
    const origin = this.served.origin;
    this.routes = {
      owner: labRoutes(origin, this.people.owner),
      member: labRoutes(origin, this.people.member),
      outsider: labRoutes(origin, this.people.outsider),
    };
    const opened = await personPage(this.browser, origin, this.people.owner, true);
    this.page = opened.page;
    this.pageErrors = opened.errors;
    this.closePage = () => opened.context.close();
    this.record.boots.push({ label, store: this.lab.store, config });
  }

  /** Stop the Lab: the next {@link boot} is a restart on the same store. */
  async stop(): Promise<void> {
    await this.closePage?.().catch(() => undefined);
    this.closePage = undefined;
    if (this.served !== undefined) {
      writeFileSync(join(this.lab.scratch, `${this.record.label}-boot-${this.record.boots.length}.log`), this.served.log());
      await this.served.stop();
    }
  }

  async open(path: string): Promise<void> {
    await openShiftManager(this.page, this.served.origin, path);
  }

  /** A browser context as another person, closed by the caller. */
  async as(who: "member" | "outsider") {
    return personPage(this.browser, this.served.origin, this.people[who], false);
  }
}

// ---- what the store holds -------------------------------------------------------

export type ProjectRow = {
  id: string;
  title: string;
  brief: string | null;
  ownerUserId: string;
  members: string[];
};

/**
 * The organization's `projects` rows, read through the person's roster
 * session (Shift Manager reads them there too). A project lists no mailbox.
 */
export async function readProjects(routes: LabRoutes): Promise<{ rows: ProjectRow[] }> {
  const reader = await rosterSession(routes);
  const manifest = await routes.get(`/sessions/${encodeURIComponent(reader)}/manifest`);
  const ref = (manifest.resources as Array<{ kind: string; pattern?: string; scope?: string; ref: string }>).find(
    (r) => r.kind === "collection" && r.pattern === "projects/*" && r.scope === "org",
  )?.ref;
  const rows = ref === undefined ? [] : ((await pageRows(routes, reader, ref)).map((i) => i.clientData ?? {}) as ProjectRow[]);
  return { rows };
}

/** The seat inventory, read through the person's roster session, which declares it. */
export async function readInventory(routes: LabRoutes): Promise<Array<Record<string, any>>> {
  return routes.collection(await rosterSession(routes), "inventory/workers/*");
}

/** One of the person's own workers, as their roster row stores it. */
export type WorkerRow = { id: string; flow: string; description: string | null };

/**
 * The person's own workers: the rows in their scope, read through their
 * session of Workforce's roster flow, as Shift Manager's Roster reads them.
 * The newest such session is used; with none yet, one is opened (it names no
 * worker and changes nothing). A row's id is its key, the last segment of its
 * topic.
 */
export async function readWorkers(routes: LabRoutes): Promise<WorkerRow[]> {
  const sessionId = await rosterSession(routes);
  const ref = await routes.refOf(sessionId, WORKERS_PATTERN);
  if (ref === undefined) throw new Error(`the roster session ${sessionId} declares no ${WORKERS_PATTERN}`);
  return (await pageRows(routes, sessionId, ref)).map((item) => {
    const data = item.clientData ?? {};
    return { id: item.topic.slice(item.topic.lastIndexOf("/") + 1), flow: String(data.flow), description: typeof data.description === "string" ? data.description : null };
  });
}

/** The person's newest session of Workforce's roster flow; with none yet, one is opened (it names no worker and changes nothing). */
async function rosterSession(routes: LabRoutes): Promise<string> {
  const listed = (await routes.sessions()).filter((s) => s.flowKind === ROSTER_FLOW && s.parentSessionId == null).sort((a, b) => b.createdAt - a.createdAt);
  if (listed[0] !== undefined) return listed[0].id;
  const made = await routes.call("POST", `/${ROSTER_FLOW}/sessions`, { userId: routes.user.userId });
  if (made.status !== 201) throw new Error(`no roster session for ${routes.user.userId}: ${made.status} ${JSON.stringify(made.body)}`);
  return String(made.body.session.id);
}

/** Every item of a collection, through one session, page by page. */
async function pageRows(routes: LabRoutes, sessionId: string, ref: string): Promise<Array<{ topic: string; clientData?: Record<string, any> }>> {
  const items: Array<{ topic: string; clientData?: Record<string, any> }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const body = await routes.get(`/sessions/${encodeURIComponent(sessionId)}/resources/${encodeURIComponent(ref)}?limit=200${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`);
    items.push(...((body.items ?? []) as typeof items));
    if (body.nextCursor === undefined || body.nextCursor === null || body.nextCursor === cursor) break;
    cursor = body.nextCursor;
  }
  return items;
}

/** The worker each person's project coordinator runs as, and its flow, as the Lab's projects flow names them (`projectSetup`). */
export async function projectCoordinatorOf(world: World): Promise<{ worker: string; flow: string } | { error: string }> {
  const owner = world.routes.owner;
  const made = await owner.call("POST", `/${PROJECTS_FLOW}/sessions`, { userId: owner.user.userId });
  if (made.status !== 201) return { error: `no ${PROJECTS_FLOW} session: ${made.status} ${JSON.stringify(made.body)}` };
  const setup = await owner.act(PROJECTS_FLOW, String(made.body.session.id), "projectSetup", {});
  const worker = (setup.output as { projectCoordinator?: unknown } | undefined)?.projectCoordinator;
  if (setup.status !== "completed" || typeof worker !== "string") return { error: `the Lab names no project coordinator: ${setup.status} ${JSON.stringify(setup.output ?? setup.error)}` };
  const flow = (await treeWorkers(world)).find((w) => w.id === worker)?.declared.flow;
  if (typeof flow !== "string") return { error: `the tree declares no "${worker}" with a flow` };
  return { worker, flow };
}

/**
 * The session a project's Stream draws in `page`, already open on that Stream,
 * checked to be `routes`' person's own project coordinator for the project: one
 * of their sessions, on the coordinator's flow, naming the coordinator as its
 * worker and `shared/<projectId>` as its project. The session id, or why not.
 */
export async function streamCoordinator(
  page: Page,
  routes: LabRoutes,
  coordinator: { worker: string; flow: string },
  projectId: string,
): Promise<{ session: string } | { why: string }> {
  const named = await page
    .waitForFunction(() => document.querySelector("[data-testid=project-stream-conversation]")?.getAttribute("data-session-id") || null, undefined, { timeout: 30_000 })
    .then((handle) => handle.jsonValue() as Promise<string>, () => undefined);
  if (named === undefined) return { why: "the Stream draws no coordinator conversation naming its session" };
  const own = (await routes.sessions()).find((s) => s.id === named);
  if (own === undefined) return { why: `the Stream draws session ${named}, which is not one of ${routes.user.userId}'s own` };
  const state = ((await routes.get(`/sessions/${encodeURIComponent(named)}`)).session?.state ?? {}) as Record<string, unknown>;
  const project = `shared/${projectId}`;
  if (own.flowKind !== coordinator.flow || state.workerId !== coordinator.worker || state.projectId !== project) {
    return { why: `the Stream draws session ${named} on ${own.flowKind} naming worker ${String(state.workerId)} and project ${String(state.projectId)}, not ${coordinator.worker} on ${coordinator.flow} for ${project}` };
  }
  return { session: named };
}

// ---- the page --------------------------------------------------------------------

export async function visible(page: Page, testId: string, timeout = 10_000): Promise<boolean> {
  try {
    await page.getByTestId(testId).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * The person's own workers Roster draws (each marked theirs), on a fresh load
 * of the page, once Roster has read their roster: by worker id, with the row's
 * text, which names the flow it runs on.
 */
export async function rosterOwn(world: World): Promise<Array<{ id: string; text: string }>> {
  const read = world.page.waitForResponse((r) => r.url().includes("/resources/") && /workforceWorkers|workforce%2Fworkers/.test(r.url()), { timeout: 20_000 });
  await world.open("/roster");
  await world.page.getByTestId("roster").waitFor();
  await read;
  await sleep(500);
  return world.page.locator("[data-testid=roster-worker][data-own=true]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-worker-id") ?? "", text: (e as HTMLElement).innerText.replace(/\s+/g, " ").trim() })));
}

/** PROJECTS as drawn: each group's project id and its workstream ids. */
export async function projectsDrawn(page: Page): Promise<Array<{ id: string; streams: string[] }>> {
  await page.getByTestId("project-group").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  return page.getByTestId("project-group").evaluateAll((els) =>
    els.map((g) => ({
      id: g.getAttribute("data-project-id") ?? "",
      streams: [...g.querySelectorAll("[data-testid^=nav-workstream-]")].map((e) =>
        e.getAttribute("data-testid") === "nav-workstream-gone" ? `gone:${e.getAttribute("data-mailbox-id")}` : e.getAttribute("data-testid")!.slice("nav-workstream-".length),
      ),
    })),
  );
}

/** The Inbox's listed asks, by suspension id, on a fresh load. */
export async function inboxAsks(world: World): Promise<string[]> {
  await world.open("/inbox");
  await world.page.getByTestId("inbox").waitFor();
  await world.page.getByTestId("inbox-item").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  return world.page.getByTestId("inbox-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-suspension-id") ?? ""));
}

/**
 * Answer one ask in Inbox the way a person does: open it, click Approve (or
 * Reject), and wait for the store to hold the answer.
 *
 * @returns What the card said, and whether the answer landed.
 */
export async function answerInInbox(world: World, suspensionId: string, action: "Approve" | "Reject"): Promise<{ card: string; clicked: boolean }> {
  await world.open(`/inbox/${encodeURIComponent(suspensionId)}`);
  const card = world.page.locator(`[data-testid=ask-card][data-suspension-id="${suspensionId}"]`);
  try {
    await card.waitFor({ timeout: 15_000 });
  } catch {
    return { card: "", clicked: false };
  }
  const text = ((await card.textContent()) ?? "").replace(/\s+/g, " ").trim();
  await card.getByRole("button", { name: action, exact: true }).click();
  return { card: text, clicked: true };
}

// ---- asking the Shift Coordinator ------------------------------------------------------

/** A provider error: the model never answered (QR-8), as opposed to a Shift Coordinator that answered wrong. */
function providerError(message: string): boolean {
  return /rate.?limit|429|5\d\d |overloaded|timed? ?out|ECONNRESET|fetch failed|provider|gateway|unavailable|AI SDK stream failed/i.test(message);
}

/** The text of a message item. */
export function textOf(item: StoredItem | undefined): string {
  if (item === undefined) return "";
  const c = item.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => String((p as { text?: unknown }).text ?? "")).join("\n");
  return JSON.stringify(c ?? "");
}

/** The workers the tree beside the profile the Lab is served from now declares, each with its `WORKER.md` frontmatter. */
export async function treeWorkers(world: World): Promise<Array<{ id: string; declared: Record<string, unknown> }>> {
  return (await readDeclaredRoster(join(dirname(world.config), "workforce"))).workers;
}

/**
 * The flow the Shift Coordinator runs on, as its `WORKER.md` names it, in the
 * tree beside the profile the Lab is served from now. A worker has no flow
 * address of its own: its sessions are sessions of this flow, naming it.
 */
export async function shiftCoordinatorFlowOf(world: World): Promise<string> {
  const flow = (await treeWorkers(world)).find((w) => w.id === SHIFT_COORDINATOR)?.declared.flow;
  if (typeof flow !== "string") throw new Error(`the tree beside ${world.config} declares no "${SHIFT_COORDINATOR}" with a flow`);
  return flow;
}

/**
 * Say `words` to the Shift Coordinator in the Shift Coordinator view, as the person
 * whose page `world.page` is, and wait for the turn to end (completed, or
 * suspended on an ask).
 *
 * Graded once (D2). Returns `undefined` when the view draws no Shift Coordinator
 * to talk to (its named no-Shift Coordinator state).
 */
export async function askShiftCoordinator(world: World, step: string, words: string): Promise<Turn | undefined> {
  const turn = await sayOnce(world, step, words);
  if (turn !== undefined && (turn.status === "failed" || turn.status === "refused") && providerError(turn.reply)) {
    const first = turn.reply;
    const again = await sayOnce(world, step, words);
    if (again !== undefined) {
      again.providerRetry = first.slice(0, 200);
      world.record.turns.push(again);
      return again;
    }
  }
  if (turn !== undefined) world.record.turns.push(turn);
  return turn;
}

async function sayOnce(world: World, step: string, words: string): Promise<Turn | undefined> {
  const { page } = world;
  await world.open("/shift-coordinator");
  await Promise.race([page.getByTestId("shift-coordinator-conversation").waitFor({ timeout: 20_000 }), page.getByTestId("shift-coordinator-none").waitFor({ timeout: 20_000 })]).catch(() => undefined);
  if ((await page.getByTestId("shift-coordinator-none").count()) > 0 || (await page.getByTestId("shift-coordinator-conversation").count()) === 0) return undefined;
  const input = page.getByTestId("shift-coordinator-composer-input");
  await input.waitFor();
  await input.fill(words);
  await page.getByTestId("shift-coordinator-composer-send").click();
  let state = "";
  for (const until = Date.now() + TURN_MS; Date.now() < until; await sleep(100)) {
    state = (await page.getByTestId("shift-coordinator-composer-status").getAttribute("data-state")) ?? "";
    if (["delivered", "refused", "not-sent", "unconfirmed"].includes(state)) break;
  }
  const turn: Turn = { step, words, sessionId: null, requestId: null, status: state || "not-delivered", tools: [], reply: "", onScreen: false };
  if (state !== "delivered") {
    turn.reply = (await page.getByTestId("shift-coordinator-composer-error").textContent({ timeout: 500 }).catch(() => null)) ?? "";
    // A turn that suspends on an ask ends "suspended" by design (FIX-1719 D2). The
    // composer may report that as not sent; the store still decides what happened.
    if (!/ended suspended/.test(turn.reply)) return turn;
    turn.composerSaid = `${state}: ${turn.reply.trim()}`;
    turn.reply = "";
  }
  // The session the line went into, as the view names it, and the request that carries the line.
  let sessionId = "";
  for (let i = 0; i < 100 && sessionId === ""; i += 1) {
    sessionId = (await page.getByTestId("shift-coordinator-conversation").getAttribute("data-session-id")) ?? "";
    if (sessionId === "") await sleep(100);
  }
  turn.sessionId = sessionId || null;
  if (sessionId === "") return { ...turn, status: "no-session" };
  const owner = world.routes.owner;
  // The conversation is a session of the Shift Coordinator's flow, bound to it as its worker when it was created.
  const flow = await shiftCoordinatorFlowOf(world);
  const session = (await owner.get(`/sessions/${encodeURIComponent(sessionId)}`)).session as { flowKind?: string; state?: Record<string, unknown> } | undefined;
  if (session?.flowKind !== flow || session.state?.workerId !== SHIFT_COORDINATOR) {
    return { ...turn, status: `wrong-session: ${sessionId} is on "${session?.flowKind}" naming worker "${String(session?.state?.workerId)}", not on "${flow}" naming "${SHIFT_COORDINATOR}"` };
  }
  const userItem = (await owner.items(sessionId, "message")).filter((m) => m.role === "user" && textOf(m).includes(words)).at(-1);
  turn.requestId = userItem?.requestId ?? null;
  if (turn.requestId === null) return { ...turn, status: "line-not-held" };
  turn.status = await owner.settle(flow, turn.requestId, TURN_MS);
  const all = await owner.items(sessionId, "tool_output,message,error");
  const mine = all.filter((i) => i.requestId === turn.requestId);
  turn.tools = mine
    .filter((i) => i.type === "tool_output")
    .map((i) => {
      const output = i.output as { ok?: unknown; error?: unknown } | undefined;
      const ok = i.status !== "failed" && i.error === undefined && !(output !== null && typeof output === "object" && (output.ok === false || output.error !== undefined));
      return { itemId: i.id, name: String(i.toolCall?.name ?? ""), args: String(i.toolCall?.arguments ?? ""), ok, output: JSON.stringify(i.output ?? i.error ?? null).slice(0, 600) };
    });
  const reply = mine.filter((i) => i.type === "message" && i.role === "assistant").at(-1);
  const error = mine.find((i) => i.type === "error");
  turn.reply = reply !== undefined ? textOf(reply) : error !== undefined ? `error: ${JSON.stringify(error.error ?? error).slice(0, 300)}` : "";
  // The reply is on screen: the view draws the stored assistant item by id.
  if (reply !== undefined) {
    await world.open("/shift-coordinator");
    try {
      await page.locator(`[data-testid=shift-coordinator-item][data-item-id="${reply.id}"]`).waitFor({ timeout: 15_000 });
      turn.onScreen = true;
    } catch {
      turn.onScreen = false;
    }
  }
  return turn;
}

/** The tool calls a turn made to a tool whose name ends with `name`. */
export function callsTo(turn: Turn | undefined, name: string) {
  return (turn?.tools ?? []).filter((t) => t.name === name || t.name.endsWith(`/${name}`) || t.name.endsWith(`.${name}`) || t.name.endsWith(`_${name}`));
}

/** One line quoting a turn, for a failure. */
export function quote(turn: Turn | undefined): string {
  if (turn === undefined) return "no Shift Coordinator to ask";
  return `turn ${turn.status} (session ${turn.sessionId}, request ${turn.requestId}); tools [${turn.tools.map((t) => `${t.name}#${t.itemId} ${t.ok ? "ok" : "not ok"}`).join(", ")}]; said "${turn.reply.slice(0, 300)}"${turn.composerSaid !== undefined ? `; composer showed "${turn.composerSaid}"` : ""}`;
}

/** The suspensions a request raised, as stored in its session. */
export async function asksOf(routes: LabRoutes, sessionId: string, requestId: string): Promise<StoredItem[]> {
  return (await routes.items(sessionId, "suspension")).filter((i) => i.requestId === requestId);
}

/** Suspension ids still pending in a session. */
export async function pendingIn(routes: LabRoutes, sessionId: string): Promise<string[]> {
  const all = await routes.items(sessionId, "suspension,suspension_resume");
  const resumed = new Set(all.filter((i) => i.type === "suspension_resume").map((i) => i.suspensionId));
  return all.filter((i) => i.type === "suspension" && !resumed.has(i.suspensionId)).map((i) => i.suspensionId!);
}
