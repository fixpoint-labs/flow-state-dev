/**
 * What every leg of this goal does the way a person does it, and what it
 * reads back from the Lab's store to grade it.
 *
 * A person asks the chief of staff in Shift Manager's Chief of Staff view,
 * answers asks in Inbox, posts in a project's Stream or a workstream's
 * composer, and reads PROJECTS and TEAMS in the sidebar. What happened is read
 * through the Lab's routes as a verified user ({@link labRoutes}), never from
 * Shift Manager's own state. Every graded turn runs once (D2): nothing here
 * retries a turn except one that hit a provider error, which is reported.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import {
  labRoutes,
  openShiftManager,
  personPage,
  serveLab,
  type LabRoutes,
  type LabUser,
  type ServedLab,
  type StoredItem,
} from "../../lib/shift-manager.mts";

/** The seat Shift Manager and the Lab find the chief of staff by. */
export const COS = "chief-of-staff";
/** How long one turn of the chief of staff may take: a real model answers it. */
export const TURN_MS = 240_000;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const hex = (n = 3) => randomBytes(n).toString("hex");
const sorted = (values: Iterable<string>) => [...values].sort();
export const same = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

// ---- the record a run keeps ---------------------------------------------------

export type Verdict = "PASS" | "FAIL" | "BLOCKED";

/** One CoS turn, as the report quotes it. */
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
  readonly boots: Array<{ label: string; store: string; problems: string[] }> = [];
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
  served!: ServedLab;
  routes!: { owner: LabRoutes; member: LabRoutes; outsider: LabRoutes };
  page!: Page;
  pageErrors: string[] = [];
  private closePage: (() => Promise<void>) | undefined;
  constructor(
    readonly browser: Browser,
    readonly people: People,
    readonly lab: { config: string; pages: string; scratch: string; store: string; env?: Record<string, string>; root?: string; tsx?: string },
    readonly record: RunRecord,
  ) {}

  /** Start (or restart, on the same store) the Lab, and open the owner's page. Records the boot's problems. */
  async boot(label: string, config = this.lab.config): Promise<void> {
    this.served = await serveLab({
      config,
      pages: this.lab.pages,
      scratch: this.lab.scratch,
      env: { DEVTEAM_STORE: this.lab.store, ...(this.lab.env ?? {}) },
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
    // Give the Lab a moment to finish writing what it prints after it serves.
    await sleep(500);
    this.record.boots.push({ label, store: this.lab.store, problems: bootProblems(this.served.log()) });
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

/** The lines a boot printed naming a stored seat it skipped (FIX-1621's start report, as the DevTeam host prints it). */
export function bootProblems(log: string): string[] {
  return log.split("\n").filter((l) => /skipped a hired seat/.test(l));
}

// ---- what the store holds -------------------------------------------------------

export type ProjectRow = {
  id: string;
  title: string;
  brief: string | null;
  ownerUserId: string;
  members: string[];
  workstreams: string[];
  sessions: Array<{ sessionId: string; userId: string }>;
};

/** The `projects` rows and the inventoried mailboxes, read through a mailbox's session. */
export async function readProjects(routes: LabRoutes, mailboxSession: string): Promise<{ rows: ProjectRow[]; mailboxes: string[] }> {
  const rows = (await routes.collection(mailboxSession, "projects/*").catch(() => [])) as ProjectRow[];
  const mailboxes = (await routes.collection(mailboxSession, "inventory/mailboxes/*").catch(() => [])).map((r) => String(r.id));
  return { rows, mailboxes };
}

/** The seat inventory, read through a mailbox's session. */
export async function readInventory(routes: LabRoutes, mailboxSession: string): Promise<Array<Record<string, any>>> {
  return routes.collection(mailboxSession, "inventory/seats/*");
}

/**
 * The organization's hired roster, read through a session whose flow declares
 * it (the person's conversation with the chief of staff). `undefined` when no
 * such session exists: a Lab with no chief of staff has no flow that mounts it.
 */
export async function readRoster(routes: LabRoutes, sessionId: string | null): Promise<Array<Record<string, any>> | undefined> {
  if (sessionId === null) return undefined;
  const ref = await routes.refOf(sessionId, "workforce/roster/*").catch(() => undefined);
  if (ref === undefined) return undefined;
  return routes.collection(sessionId, "workforce/roster/*");
}

/** Every line of a project's room after `after`, read through one talk session's `read` action. */
export async function readRoom(routes: LabRoutes, talkSession: string): Promise<Array<{ seq: number; userId: string; author: string | null; body: string }>> {
  const kind = String((await routes.get(`/sessions/${encodeURIComponent(talkSession)}`)).session?.flowKind ?? "");
  const lines: Array<{ seq: number; userId: string; author: string | null; body: string; tombstone?: boolean }> = [];
  let cursor = 0;
  for (let page = 0; page < 200; page += 1) {
    const read = await routes.act(kind, talkSession, "read", { after: cursor });
    if (read.status !== "completed") throw new Error(`read refused (${read.status}): ${read.error ?? ""}`);
    lines.push(...((read.output?.lines ?? []) as typeof lines));
    const next = Number(read.output?.nextCursor);
    if (!(next > cursor)) break;
    cursor = next;
  }
  return lines.filter((l) => l.tombstone !== true);
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

/** The seat ids TEAMS draws, on a fresh load of the page. */
export async function teamsSeats(world: World): Promise<string[]> {
  await world.open("/cos");
  await world.page.getByTestId("teams").waitFor();
  await world.page.locator("[data-testid=teams] [data-testid=worker]").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  return world.page.locator("[data-testid=teams] [data-testid=worker]").evaluateAll((els) => els.map((e) => e.getAttribute("data-seat-id") ?? ""));
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

// ---- asking the chief of staff ------------------------------------------------------

/** A provider error: the model never answered (QR-8), as opposed to a CoS that answered wrong. */
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

/**
 * Say `words` to the chief of staff in the Chief of Staff view, as the person
 * whose page `world.page` is, and wait for the turn to end (completed, or
 * suspended on an ask).
 *
 * Graded once (D2). Returns `undefined` when the view draws no chief of staff
 * to talk to (its named no-CoS state).
 */
export async function askCos(world: World, step: string, words: string): Promise<Turn | undefined> {
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
  await world.open("/cos");
  await Promise.race([page.getByTestId("cos-conversation").waitFor({ timeout: 20_000 }), page.getByTestId("cos-none").waitFor({ timeout: 20_000 })]).catch(() => undefined);
  if ((await page.getByTestId("cos-none").count()) > 0 || (await page.getByTestId("cos-conversation").count()) === 0) return undefined;
  const input = page.getByTestId("cos-composer-input");
  await input.waitFor();
  await input.fill(words);
  await page.getByTestId("cos-composer-send").click();
  let state = "";
  for (const until = Date.now() + TURN_MS; Date.now() < until; await sleep(100)) {
    state = (await page.getByTestId("cos-composer-status").getAttribute("data-state")) ?? "";
    if (["delivered", "refused", "not-sent", "unconfirmed"].includes(state)) break;
  }
  const turn: Turn = { step, words, sessionId: null, requestId: null, status: state || "not-delivered", tools: [], reply: "", onScreen: false };
  if (state !== "delivered") {
    turn.reply = (await page.getByTestId("cos-composer-error").textContent({ timeout: 500 }).catch(() => null)) ?? "";
    // A turn that suspends on an ask ends "suspended" by design (FIX-1719 D2). The
    // composer may report that as not sent; the store still decides what happened.
    if (!/ended suspended/.test(turn.reply)) return turn;
    turn.composerSaid = `${state}: ${turn.reply.trim()}`;
    turn.reply = "";
  }
  // The session the line went into, as the view names it, and the request that carries the line.
  let sessionId = "";
  for (let i = 0; i < 100 && sessionId === ""; i += 1) {
    sessionId = (await page.getByTestId("cos-conversation").getAttribute("data-session-id")) ?? "";
    if (sessionId === "") await sleep(100);
  }
  turn.sessionId = sessionId || null;
  if (sessionId === "") return { ...turn, status: "no-session" };
  const owner = world.routes.owner;
  const userItem = (await owner.items(sessionId, "message")).filter((m) => m.role === "user" && textOf(m).includes(words)).at(-1);
  turn.requestId = userItem?.requestId ?? null;
  if (turn.requestId === null) return { ...turn, status: "line-not-held" };
  turn.status = await owner.settle(COS, turn.requestId, TURN_MS);
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
    await world.open("/cos");
    try {
      await page.locator(`[data-testid=cos-item][data-item-id="${reply.id}"]`).waitFor({ timeout: 15_000 });
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
  if (turn === undefined) return "no chief of staff to ask";
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
