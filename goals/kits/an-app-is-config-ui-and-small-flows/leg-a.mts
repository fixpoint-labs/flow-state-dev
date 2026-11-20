/**
 * Leg a, in a browser on a real model: the Claude Code-style lab, served
 * from its own config, a person starts a thread in the Projects view, the
 * lead delegates a coding task (harness-manager's scripted coder runs it),
 * the task's row changes on the board, they resolve its review and pin it.
 *
 * Graded on the rendered page (`data-task-id`, `data-task-status`,
 * `data-column`, `aria-pressed`), the browser's own traffic (view reads,
 * socket frames) and the store (sessions, requests, every user and org
 * resource's versions). Never on the lab's hooks or a view's answer.
 *
 * Also gathers what leg w and journey j4 read from the same run: the
 * versions written, the board's re-reads and the socket's frames.
 */
import { join } from "node:path";
import type { Page } from "playwright";
import { createClient } from "@flow-state-dev/client";
import { goalTmpDir, RUN_STAMP, stopProcessGroup, type Tell } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { labCheckout, makeRepository, sleep, startLab } from "../../claude-code-style-lab/lab.mts";
import { storeAt, watchVersions, type Store, type Version } from "./store.mts";
import { columnOf } from "../../../labs/claude-code-style/src/lib/columns.ts";

/** The lead, its flow, and the coder it hands a code change to. */
const LEAD = { worker: "desk.lead", flow: "coordinator", coder: "desk.thread-coder" };
/** The default write flow's kind: a pin is one request on it. */
export const DEFAULT_WRITE_FLOW = "fsd-default-write";
/** What the page must keep under: a row shows the store's change within this, and an idle page sends no view read for this long. */
const WITHIN_MS = 1_000;
const IDLE_MS = 10_000;

export type LegA = {
  outcome: "graded" | "retry";
  /** What leg w and j4 read. */
  versions: Version[];
  /** Keys whose versions skipped one in the write log. */
  gaps: string[];
  store?: Store;
  startedAt: number;
  user: string;
  /** Each answer the page got from the coding board's view, with the change notice its request named (none for a first read or a reload). */
  boardReads: { at: number; body: any; changed?: { ids?: string[]; kind?: string; topic?: unknown } }[];
  frames: string[];
  task?: { id: string; title: string; goal: string };
  /** The second task the goal files on the board, for j4. */
  secondTask?: string;
  stateChanges: { status: string; column: string; storeAt: number; pageAt?: number }[];
  /** The lab's server, for leg w's probes, still running. */
  stop: () => void;
  origin?: string;
  sessionId?: string;
};

/** What a poll of the page saw: your lines, the lead's entries, the board's rows. */
type Shown = { at: number; mine: string[]; replies: number; rows: { id: string; status: string; column: string }[] };

const shown = (page: Page): Promise<Shown> =>
  page.evaluate(() => {
    const thread = document.querySelector('main[aria-label="Main thread"]');
    return {
      at: Date.now(),
      mine: [...(thread?.querySelectorAll('[data-entry="user"]') ?? [])].map((el) => (el.textContent ?? "").trim()),
      replies: thread?.querySelectorAll('[data-entry="assistant"], [data-entry="thread"], [data-entry="brief"]').length ?? 0,
      rows: [...document.querySelectorAll('aside[aria-label="Tasks"] [data-task-id]')].map((el) => ({
        id: el.getAttribute("data-task-id") ?? "",
        status: el.getAttribute("data-task-status") ?? "",
        column: el.closest("section[data-column]")?.getAttribute("data-column") ?? "",
      })),
    };
  });

/**
 * Before the page's own scripts: every change to a board row's status or
 * column, with when it showed, so a row's latency is read from the page's
 * clock (the same host clock the store is watched on), not a poll's.
 */
const ROW_WATCH = `(() => {
  const seen = new Map(); window.__closureRows = [];
  const look = () => {
    // A person keeps the board's groups open to watch the row: a group first drawn shut is opened.
    for (const shut of document.querySelectorAll('aside[aria-label="Tasks"] button[aria-expanded="false"]')) shut.click();
    for (const el of document.querySelectorAll('aside[aria-label="Tasks"] [data-task-id]')) {
      const id = el.getAttribute("data-task-id"); const status = el.getAttribute("data-task-status") || "";
      const column = (el.closest("section[data-column]") || { getAttribute: () => "" }).getAttribute("data-column") || "";
      const now = status + "|" + column;
      if (seen.get(id) !== now) { seen.set(id, now); window.__closureRows.push({ id, status, column, at: Date.now() }); }
    }
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-task-status", "data-column"] });
})();`;

/**
 * The column a board row lands in, from the task's stored state, by the lab's own pure `columnOf`:
 * the row is graded before it is pinned and it never fails, so neither pin nor dismissal applies.
 * A task's `holds` are its open holds (an answered one leaves the list); the first is the one the row shows,
 * read as the coding board view's `asks` lists it, which is what `columnOf` reads.
 */
function columnOfStored(task: any): string {
  const asks = ((task.holds ?? []) as Array<{ ask: unknown }>).slice(0, 1).map((hold) => ({ ask: hold.ask }));
  return columnOf({ status: task.status, asks } as unknown as Parameters<typeof columnOf>[0], false, false);
}

/** One attempt of leg a. `env` is the control's, for the lab's server. */
export async function legA(n: number, ask: string, failures: string[], notes: string[], tell: Tell, env: Record<string, string>): Promise<LegA> {
  const scratch = goalTmpDir(`closure-leg-a-${n}`);
  const data = join(scratch, "data");
  const repo = makeRepository(join(scratch, "repo"), { "NOTES.md": "# Notes\n\n- Started the notes.\n" });
  const user = `u_closure_${RUN_STAMP.replace(/\W/g, "")}`;
  const labBefore = labCheckout();
  const startedAt = Date.now();
  const lab = await startLab(data, user, {
    CLAUDE_CODE_STYLE_HARNESS: "stub",
    CLAUDE_CODE_STYLE_HARNESS_STEP_MS: "2000",
    CLAUDE_CODE_STYLE_REPOSITORIES: repo,
    GOAL_FLOWS: join(import.meta.dirname, "probe-flow.mts"),
    ...env,
  });
  const store = storeAt(join(data, "lab.db"));
  const watch = watchVersions(store);
  // The watch runs on through leg w's probes; stopping the leg stops both.
  const stop = () => {
    watch.stop();
    stopProcessGroup(lab.child);
  };
  const result: LegA = { outcome: "graded", versions: watch.versions, gaps: watch.gaps, store, startedAt, user, boardReads: [], frames: [], stateChanges: [], stop, origin: lab.origin };
  const fsd = createClient({ userId: user, baseUrl: lab.origin });
  let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(30_000);
    await page.addInitScript(ROW_WATCH);
    const viewReads: { at: number; url: string }[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/views\/[^/?]+/.test(r.url())) viewReads.push({ at: Date.now(), url: r.url() });
    });
    page.on("response", async (r) => {
      if (r.request().method() === "POST" && /\/views\/codingBoard\b/.test(r.url())) {
        const body = await r.json().catch(() => undefined);
        const sent = (r.request().postDataJSON() ?? {}) as { changed?: { ids?: string[]; kind?: string; topic?: unknown } };
        result.boardReads.push({ at: Date.now(), body, ...(sent.changed !== undefined ? { changed: sent.changed } : {}) });
      }
    });
    page.on("websocket", (ws) => ws.on("framereceived", (f) => result.frames.push(typeof f.payload === "string" ? f.payload : f.payload.toString("utf8"))));
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(lab.origin);
    await page.getByRole("tab", { name: "Projects" }).click();
    await page.getByRole("region", { name: "Choose a project" }).waitFor();
    const form = page.getByRole("form", { name: "New project" });
    await form.getByLabel("Project name").fill("Closure notes");
    await form.getByLabel("Repository").fill(`file://${repo}`);
    await form.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("region", { name: "Choose a project" }).getByRole("button", { name: "Closure notes" }).click();
    const box = page.getByRole("textbox", { name: "Message the main session" });
    await box.waitFor();
    const sessionId = store.sessions(startedAt).filter((s) => s.flow_kind === LEAD.flow && s.user_id === user).sort((a, b) => b.created_at - a.created_at)[0]?.id;
    if (sessionId === undefined) throw new Error("setup: no lead session was made when the project was picked");
    result.sessionId = sessionId;

    // ── a:thread · your line, and the lead's reply.
    await box.fill(ask);
    await box.press("Enter");
    const replied = await until(async () => {
      const now = await shown(page);
      return now.mine.some((t) => t.includes(ask.slice(0, 30))) && now.replies > 0 ? now : undefined;
    }, 5 * 60_000, 1_000);
    const atReply = replied ?? (await shown(page));
    if (!atReply.mine.some((t) => t.includes(ask.slice(0, 30)))) failures.push("a:thread: your line never showed in the thread");
    if (atReply.replies === 0) failures.push("a:thread: the lead's reply never showed in the thread");

    // ── a:delegate · a coding task, on the board on the server and as a row in the pane.
    /** A task on this session's board, as the store holds it: the coder's, or the one named `id`. */
    const taskOf = (id?: string) => {
      const tasks = store
        .resources()
        .filter((r) => r.resource_key.startsWith("tasks/") && decodeURIComponent(r.resource_key).includes(sessionId))
        .map((r) => JSON.parse(r.state));
      return id === undefined ? tasks.find((t) => t.assignee === LEAD.coder) : tasks.find((t) => t.id === id);
    };
    const filed = await until(async () => taskOf(), 5 * 60_000, 1_000);
    if (filed === undefined) {
      notes.push("the lead filed no coding task");
      result.outcome = "retry";
      return result;
    }
    result.task = { id: filed.id, title: filed.title ?? "", goal: filed.goal ?? "" };
    // A second task on the board, so a re-read that answers the whole board shows as more than one row (j4).
    const second = await fsd.flow(LEAD.flow).send("createTask_tasks", { title: "Second closure note", goal: "Leave a second short note in the project's repository, as a new file, saying a second coding task ran here, and commit it.", assignee: LEAD.coder }, { sessionId });
    const secondOut = (await second.result()).output as { taskId?: string } | undefined;
    if (typeof secondOut?.taskId !== "string") notes.push("j4: the second task wasn't filed, so a whole-board answer is one row");
    else result.secondTask = secondOut.taskId;
    const listed = await fsd.flow(LEAD.flow).send("listTasks_tasks", {}, { sessionId });
    const listOut = (await listed.result()).output as { tasks?: { id: string }[] } | undefined;
    if (!(listOut?.tasks ?? []).some((t) => t.id === filed.id)) failures.push(`a:delegate: the session's board (listTasks_tasks) doesn't list ${filed.id}`);
    const rowShown = await until(async () => ((await shown(page)).rows.some((r) => r.id === filed.id) ? true : undefined), 30_000, 250);
    if (rowShown === undefined) failures.push(`a:delegate: no row for ${filed.id} in the Tasks pane`);

    // ── a:row-changes · each change of the task's status or column, timed from the store to the page.
    const changes = result.stateChanges;
    let lastKey = "";
    const noteChange = (task: any, at: number) => {
      const key = `${task.status}|${columnOfStored(task)}`;
      if (key === lastKey) return;
      lastKey = key;
      changes.push({ status: task.status, column: columnOfStored(task), storeAt: at });
    };
    noteChange(filed, Date.now());
    watch.onVersion((v) => {
      if (v.key.endsWith(`/${filed.id}`) && v.key.startsWith("tasks/")) noteChange(v.state, v.seenAt);
    });
    // The scripted coder runs, then holds its work for your review: Resolve on its card, as a person does.
    const review = await until(async () => {
      const now = taskOf(filed.id);
      return columnOfStored(now) === "review" || ["errored", "cancelled", "completed"].includes(now?.status) ? now : undefined;
    }, 5 * 60_000, 500);
    if (review?.status === "errored" && /judge/.test(String(review.statusNote ?? review.error ?? JSON.stringify(review).slice(0, 4000)))) {
      // The judge, a model, read the scripted run against the lead's goal and sent it back: the model gave nothing to grade.
      notes.push(`the judge sent the scripted run back (${String(review.statusNote ?? "").slice(0, 160)})`);
      result.outcome = "retry";
      return result;
    }
    if (review === undefined || columnOfStored(review) !== "review") {
      const now = taskOf(filed.id);
      failures.push(`a:row-changes: the coding task never held its work for review (${now?.status}: ${now?.statusNote ?? ""})`);
    } else {
      await until(async () => ((await shown(page)).rows.find((r) => r.id === filed.id)?.column === "review" ? true : undefined), 10_000, 100);
      await page
        .locator(`main[aria-label="Main thread"] [data-entry="thread"][data-task-id="${filed.id}"]`)
        .getByRole("button", { name: /^(Resolve|Merge locally)$/ })
        .first()
        .click()
        .catch((error: Error) => failures.push(`a:row-changes: no accept on the task's card to resolve its review: ${error.message.split("\n")[0]}`));
      const done = await until(async () => (taskOf(filed.id)?.status === "completed" ? true : undefined), 3 * 60_000, 250);
      if (done === undefined) failures.push(`a:row-changes: ${filed.id} never read completed after Resolve`);
    }
    await sleep(3_000);
    const pageRows = (await page.evaluate(() => (window as any).__closureRows as { id: string; status: string; column: string; at: number }[])).filter((r) => r.id === filed.id);
    // Each change in turn, matched to the first time the row showed it after the change before it showed:
    // the watcher looks every 100 ms, so a row may show a change a little before the watcher sees it.
    let shownBefore = 0;
    for (const change of changes) {
      change.pageAt = pageRows.find((r) => r.status === change.status && r.column === change.column && r.at >= shownBefore)?.at;
      if (change.pageAt !== undefined) shownBefore = change.pageAt;
    }
    tell.over("a:row-changes · the task's changes in the store", changes);
    const statuses = new Set(changes.map((c) => c.status));
    if (!statuses.has("in_progress") || !statuses.has("completed")) failures.push(`a:row-changes: the store never showed the task go from in_progress to completed (${[...statuses].join(", ")})`);
    for (const c of changes) {
      if (c.pageAt === undefined) failures.push(`a:row-changes: the row never showed ${c.status} under ${c.column}`);
      else if (c.pageAt - c.storeAt > WITHIN_MS) failures.push(`a:row-changes: the row showed ${c.status} under ${c.column} ${c.pageAt - c.storeAt} ms after the store, over ${WITHIN_MS}`);
    }
    notes.push(`row latencies: ${changes.map((c) => `${c.status}/${c.column} ${c.pageAt === undefined ? "never" : `${c.pageAt - c.storeAt} ms`}`).join(", ")}`);

    // 10 s idle: no request running, no version written, and the page sends no view read.
    await until(async () => (store.requests(startedAt).every((r) => !["running", "pending", "queued"].includes(r.status)) ? true : undefined), 60_000, 1_000);
    // …and nothing written for 3 s, so the window starts after the last change the page should hear.
    await until(async () => (Date.now() - (watch.versions.at(-1)?.seenAt ?? 0) > 3_000 ? true : undefined), 60_000, 500);
    const idleFrom = Date.now();
    const versionsBefore = watch.versions.length;
    await sleep(IDLE_MS);
    const idleReads = viewReads.filter((r) => r.at >= idleFrom);
    const written = watch.versions.slice(versionsBefore);
    if (written.length > 0) notes.push(`idle window not quiet: ${written.map((v) => `${v.key} v${v.version}`).join(", ")}`);
    if (idleReads.length > 0) failures.push(`a:row-changes: in ${IDLE_MS / 1000} s idle the page sent ${idleReads.length} view read(s): ${[...new Set(idleReads.map((r) => new URL(r.url).pathname))].join(", ")}`);
    notes.push(`idle: ${idleReads.length} view reads in ${IDLE_MS / 1000} s; ${viewReads.length} view reads in all`);

    // ── a:pin · Pin on the task, through the default write flow, still pinned after a reload.
    try {
      const pinFrom = Date.now();
      await page.locator(`aside[aria-label="Tasks"] [data-task-id="${filed.id}"]`).click();
      const sheet = page.locator('[role="dialog"][aria-label^="Task: "]');
      await sheet.getByRole("button", { name: "Pin", exact: true }).click();
      const pressed = await until(async () => ((await sheet.getByRole("button", { name: "Unpin", exact: true }).getAttribute("aria-pressed")) === "true" ? true : undefined), 10_000, 100);
      if (pressed === undefined) failures.push("a:pin: the button never showed the task pinned");
      await page.reload();
      await page.getByRole("tab", { name: "Projects" }).click().catch(() => undefined);
      const pinnedAfter = await until(async () => ((await shown(page)).rows.find((r) => r.id === filed.id)?.column === "pinned" ? true : undefined), 30_000, 250);
      if (pinnedAfter === undefined) {
        // A reload may land on no session: open the one the run made, as a person would.
        await page.getByRole("navigation", { name: "Sessions" }).locator("li button").first().click().catch(() => undefined);
        const again = await until(async () => ((await shown(page)).rows.find((r) => r.id === filed.id)?.column === "pinned" ? true : undefined), 30_000, 250);
        if (again === undefined) failures.push("a:pin: after a reload the task's row isn't under Pinned");
      }
      const pins = store.resources().find((r) => r.scope_type === "user" && r.resource_key === "lab-pins");
      if (!(pins !== undefined && (JSON.parse(pins.state).pinned ?? []).includes(filed.id))) failures.push(`a:pin: the store's lab-pins doesn't hold ${filed.id}`);
      const writes = store.requests(pinFrom).filter((r) => r.created_at >= pinFrom);
      const onDefault = writes.filter((r) => r.flow_kind === DEFAULT_WRITE_FLOW);
      const sessions = new Map(store.sessions().map((s) => [s.id, s]));
      if (onDefault.length !== 1) failures.push(`a:pin: ${onDefault.length} request(s) on the default write flow for one pin (all new requests: ${writes.map((r) => r.flow_kind).join(", ") || "none"})`);
      for (const r of onDefault) {
        const s = r.session_id === null ? undefined : sessions.get(r.session_id);
        if (s === undefined || s.user_id !== user || r.user_id !== user) failures.push(`a:pin: the pin's request ${r.id} isn't in a session owned by ${user} (session ${r.session_id}, its user ${s?.user_id}, the request's ${r.user_id})`);
      }
      notes.push(`pin: ${writes.length} new request(s): ${writes.map((r) => `${r.flow_kind} ${r.status}`).join(", ")}`);
      if (errors.length > 0) notes.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);
    } catch (error) {
      // A page that never drew the row can't be pinned from it: graded, not thrown.
      failures.push(`a:pin: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }

    // ── a:no-read-session · every session the run made has a request, a task or a run in it.
    const made = tell.over("a:no-read-session · sessions the run made", store.sessions(startedAt).filter((s) => s.flow_kind !== "closure-probe"));
    const requested = new Set(store.requests(startedAt).map((r) => r.session_id));
    const taskText = store.resources().filter((r) => r.resource_key.startsWith("tasks/") || r.resource_key.startsWith("runs/")).map((r) => `${r.resource_key} ${r.state}`).join("\n");
    for (const s of made) {
      if (requested.has(s.id) || taskText.includes(s.id) || taskText.includes(s.id.replace(/_/g, "%5F"))) continue;
      failures.push(`a:no-read-session: session ${s.id} (${s.flow_kind}) has no request, task or run: made only to read`);
    }
    if (labCheckout() !== labBefore) failures.push("the lab's own checkout changed");
    return result;
  } catch (error) {
    result.stop();
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** Poll `check` every `everyMs` until it answers, or `forMs` passes. */
async function until<T>(check: () => Promise<T | undefined>, forMs: number, everyMs: number): Promise<T | undefined> {
  for (const end = Date.now() + forMs; Date.now() < end; await sleep(everyMs)) {
    const value = await check().catch(() => undefined);
    if (value !== undefined) return value;
  }
  return undefined;
}
