/** See goal.md. `GOAL_CONTROL=page-does-not-save` must fail `reload` and `edit-is-followed`. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { createSessionClient } from "@flow-state-dev/client";
import { WORKER_ID_STATE_KEY, createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { REPO_ROOT, goalTmpDir, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import {
  buildShiftManagerCopy,
  buildShiftManagerPages,
  labRoutes,
  openShiftManager,
  personPage,
  startShiftManager,
  type Patch,
  type StoredItem,
} from "../../lib/shift-manager.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROL !== "page-does-not-save") throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; this goal knows page-does-not-save`);
const SCRATCH = goalTmpDir("standing-rules-page");
const DEVTEAM = join(REPO_ROOT, "packages", "shift-manager", "teams", "devteam");
const WORKER = "researcher";
/** A worker on DevTeam's own `coder` flow, which keeps no rules. */
const CUSTOM_FLOW_WORKER = "eng.coder";
const ADDED = { marker: "Page —", text: "Start every reply with `Page —`." };
const EDITED = { marker: "Edited —", text: "Start every reply with `Edited —`." };
const ASKS = [
  "In one sentence, what does a code review catch that tests miss?",
  "In one sentence, why do teams pin dependency versions?",
  "In one sentence, what is the trade-off of a monorepo?",
];

const CONTROL_PATCHES: Patch[] = [
  {
    file: "src/lib/rules.ts",
    from: "const list = await workforce.standingRules(",
    to:
      "const list = ((l, i) => ({ ...l, version: l.version + 1, rules: i.op === \"add\" ? [...l.rules, { number: l.rules.length + 1, text: i.text, addedAt: Date.now(), sessionId: null }] : i.op === \"change\" ? l.rules.map((r) => (r.number === i.rule.number ? { ...r, text: i.text } : r)) : l.rules.filter((r) => r.number !== i.rule.number).map((r, n) => ({ ...r, number: n + 1 })) }))(read.list, input) ?? await workforce.standingRules(",
    why: "the page edits its own copy of the list and never calls the rules action",
  },
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const RUNNING = new Set(["pending", "queued", "in_progress", "running"]);
const edges = (reply: string) => reply.trim().replace(/^[*_`"“]+/, "").trim();

function textOf(item: StoredItem): string {
  const c = item.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => String((p as { text?: unknown }).text ?? "")).join("");
  return "";
}

async function drawn(page: Page): Promise<string[]> {
  return page.getByTestId("rule-text").allTextContents();
}

await runGoal(async (failures) => {
  const keys = ["AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"].filter((k) => (process.env[k] ?? "") !== "");
  if (keys.length === 0) throw new Error("blocked: no model credential (AI_GATEWAY_API_KEY, OPENAI_API_KEY or OPENROUTER_API_KEY)");
  const host = (await import(join(DEVTEAM, "host.mts"))) as { LAB_USERS: Record<"owner", { userId: string; bearer: string }> };
  const alice = host.LAB_USERS.owner;

  const pages = CONTROL === "" ? await buildShiftManagerPages(join(SCRATCH, "pages")) : (await buildShiftManagerCopy(SCRATCH, "control", CONTROL_PATCHES)).pages;
  const store = join(SCRATCH, "store");
  mkdirSync(store, { recursive: true });
  const served = await startShiftManager({ scratch: SCRATCH, label: "devteam", config: join(DEVTEAM, "fsdev.config.mts"), pages, env: { DEVTEAM_STORE: join(store, "devteam.sqlite") }, timeoutMs: 180_000 });
  const browser = await launchChromium();
  const evidence: string[] = [];
  try {
    const fetcher: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${alice.bearer}`);
      return fetch(input, { ...init, headers });
    };
    const routes = labRoutes(served.origin, alice);
    const workforce = createWorkforceClient({ userId: alice.userId, baseUrl: served.origin, fetcher });
    const sessions = createSessionClient({ baseUrl: served.origin, fetcher });
    const roster = await workforce.roster();
    const researcher = roster.find((w) => w.id === WORKER);
    if (researcher === undefined) throw new Error(`setup: the roster has no ${WORKER}: ${roster.map((w) => w.id).join(", ")}`);

    /** A reply in a brand-new conversation with the researcher. */
    const freshReply = async (ask: string): Promise<string> => {
      const sessionId = `conv_goal_${Math.random().toString(16).slice(2, 14)}`;
      await sessions.createSession({ flowKind: researcher.flow, userId: alice.userId, sessionId, state: { [WORKER_ID_STATE_KEY]: researcher.id } });
      const posted = await routes.call("POST", `/${researcher.flow}/${sessionId}/actions/run`, { userId: alice.userId, input: { message: ask } });
      if (posted.status !== 202) return `refused ${posted.status}`;
      const requestId = String(posted.body?.request?.id);
      for (const until = Date.now() + 240_000; Date.now() < until; await sleep(500)) {
        const now = await routes.status(researcher.flow, requestId);
        if (now !== undefined && !RUNNING.has(now)) break;
      }
      const mine = (await routes.items(sessionId, "message")).filter((i) => i.requestId === requestId && i.role === "assistant").map(textOf);
      return mine.filter((t) => !t.startsWith("✎") && t.trim() !== "").at(-1) ?? "";
    };
    const threeReplies = async () => {
      const replies: string[] = [];
      for (const ask of ASKS) replies.push(await freshReply(ask));
      return replies;
    };

    const { context, page, errors } = await personPage(browser, served.origin, alice, true);
    try {
      // way-in: Roster offers Rules on the researcher; a custom-flow worker says it keeps none.
      await openShiftManager(page, served.origin, "/roster");
      const row = (id: string) => page.locator(`[data-testid=roster-worker][data-worker-id="${id}"]`);
      await row(WORKER).waitFor();
      const customLine = await row(CUSTOM_FLOW_WORKER).getByTestId("roster-worker-no-rules").textContent().catch(() => null);
      if (customLine === null || !/doesn't keep standing rules/.test(customLine)) failures.push(`way-in: ${CUSTOM_FLOW_WORKER}'s row says ${JSON.stringify(customLine)}, not that its flow keeps no rules`);
      if ((await row(CUSTOM_FLOW_WORKER).getByTestId("roster-worker-rules").count()) !== 0) failures.push(`way-in: ${CUSTOM_FLOW_WORKER}, on a custom flow, has a Rules button`);
      await row(WORKER).getByTestId("roster-worker-rules").click();
      await page.getByTestId("rules").waitFor();
      if (new URL(page.url()).pathname !== `/roster/${WORKER}/rules`) failures.push(`way-in: Rules opened ${page.url()}`);

      // empty: the view says none and offers to add one, with the limits.
      const empty = await page.getByTestId("rules-empty").textContent({ timeout: 20_000 }).catch(() => null);
      if (empty === null) failures.push("empty: the researcher's Rules drew no empty state");
      const limits = (await page.getByTestId("rules-limits").textContent()) ?? "";
      if (!/20/.test(limits) || !/300 characters/.test(limits)) failures.push(`limits: the page shows ${JSON.stringify(limits)}`);

      // add, then edit, on the page.
      await page.getByTestId("rule-add-input").fill(ADDED.text);
      await page.getByTestId("rule-add").click();
      await page.getByTestId("rule-text").first().waitFor();
      const afterAdd = await drawn(page);
      const origin = await page.getByTestId("rule-origin").first().textContent();
      await page.getByTestId("rule-edit").first().click();
      await page.getByTestId("rule-input").fill(EDITED.text);
      await page.getByTestId("rule-save").click();
      await page.getByTestId("rule-input").waitFor({ state: "detached" });
      const afterEdit = await drawn(page);
      if (JSON.stringify(afterAdd) !== JSON.stringify([ADDED.text]) || origin !== "added here") failures.push(`add: the page drew ${JSON.stringify(afterAdd)}, origin ${JSON.stringify(origin)}`);
      if (JSON.stringify(afterEdit) !== JSON.stringify([EDITED.text])) failures.push(`edit: the page drew ${JSON.stringify(afterEdit)}`);

      // reload: what is drawn again is what the Lab holds.
      await openShiftManager(page, served.origin, `/roster/${WORKER}/rules`);
      await page.getByTestId("rules").waitFor();
      await page.waitForFunction(() => document.querySelector("[data-testid=rules-reading]") === null);
      const reloaded = await drawn(page);
      if (JSON.stringify(reloaded) !== JSON.stringify([EDITED.text])) failures.push(`reload: after a reload the page draws ${JSON.stringify(reloaded)}, not the edited rule`);

      // edit-is-followed: three fresh conversations open with the edited marker only.
      const followed = await threeReplies();
      const follows = followed.filter((r) => edges(r).startsWith(EDITED.marker) && !r.includes(ADDED.marker)).length;
      if (follows !== 3) failures.push(`edit-is-followed: ${follows} of 3 fresh conversations opened with only "${EDITED.marker}": ${followed.map((r) => JSON.stringify(r.slice(0, 120))).join(" | ")}`);
      else evidence.push(`after the page's add and edit, 3/3 fresh conversations opened "${EDITED.marker}" only`);

      if (CONTROL === "") {
        // delete: the page empties, and the next conversations drop the marker.
        await page.getByTestId("rule-delete").first().click();
        await page.getByTestId("rules-empty").waitFor();
        const dropped = await threeReplies();
        const still = dropped.filter((r) => edges(r).startsWith(EDITED.marker)).length;
        if (still !== 0) failures.push(`delete: ${still} of 3 conversations after the delete still opened "${EDITED.marker}": ${dropped.map((r) => JSON.stringify(r.slice(0, 120))).join(" | ")}`);
        else evidence.push("after the page's delete, 0/3 opened with it");

        // cos: the Shift Coordinator's panel carries RULES for the chief of staff.
        await openShiftManager(page, served.origin, "/cos");
        const panelRules = page.locator('[data-testid=cos-panel] [data-testid=rules][data-worker-id="chief-of-staff"]');
        const cosOk = await panelRules.waitFor({ timeout: 20_000 }).then(() => true, () => false);
        if (!cosOk) failures.push("cos: the Shift Coordinator's panel draws no RULES for chief-of-staff");
        else evidence.push("the Shift Coordinator's panel draws RULES for chief-of-staff");
      }
      if (errors.length > 0) failures.push(`reach: the page threw: ${errors.join(" | ")}`);
      evidence.push(`Roster: ${CUSTOM_FLOW_WORKER} says its flow keeps no rules; the researcher's Rules opened empty with the limits, drew the add ("added here") and the edit, and the edit again after a reload`);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    writeFileSync(join(store, "server.log"), served.log());
    await served.stop();
  }
  return { failures, evidence: evidence.join("; ") };
});
