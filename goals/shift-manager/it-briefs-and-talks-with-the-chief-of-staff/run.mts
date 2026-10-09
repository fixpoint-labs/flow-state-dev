/**
 * Goal check: a person opening a Lab in Shift Manager lands on Chief of Staff,
 * sees a summary of what waits on them and what is running that agrees with
 * the store, answers an ask there, and talks to the Lab's chief-of-staff seat,
 * with every line and reply being what that seat's session holds. See goal.md
 * for the contract.
 *
 * Real path, real model. Shift Manager is built with Vite and served by its
 * own command over two Labs: this goal's desk (`lab/fsdev.config.mts`),
 * whose `desk.chief-of-staff` seat runs the built-in `agent` kind on
 * `openai/gpt-5.4-mini`, and the same desk with no chief of staff
 * (`lab-no-cos/`).
 * Chromium drives the page. What happened is read from the store, through each
 * Lab's routes with this script's own requests. Never from Shift Manager's state.
 *
 * Legs (each failure is tagged `[<lab>] <leg>`):
 *
 *   landing  `/` and an unknown path draw Chief of Staff, its entry current
 *   summary  the needs-you count equals the store's pending asks, every one is
 *            listed, and each stream's running and needs-you counts equal its
 *            rows and its members' asks
 *   inline   Approve on one summary ask leaves one fewer pending suspension in
 *            the store, and both the summary and Inbox drop it
 *   talk     a fresh token typed to the chief of staff is a user item in its
 *            seat's session the moment *delivered* is drawn, and the reply on
 *            screen is that session's next assistant item, by id
 *   again    a reload shows the same conversation
 *   no CoS   the Lab with no chief of staff lands on the view with its summary and the named state in
 *            place of the composer
 *   reach    the pages throw nothing
 *
 * Controls:
 *
 *   optimistic-reply  Shift Manager built with `src/lib/conversation.ts` (the
 *                     conversation hook) and `src/lib/send.ts` (the send path
 *                     its composer calls) swapped for
 *                     `controls/optimistic-reply.ts`: the line and a canned
 *                     reply are drawn without calling the door. Must fail at
 *                     "talk".
 *   static-brief      built with `src/lib/derive.ts` swapped for
 *                     `controls/static-brief.ts`: the summary's asks are
 *                     written in at the first read. Must fail at "inline".
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-briefs-and-talks-with-the-chief-of-staff/run.mts
 * Control:  GOAL_CONTROL=optimistic-reply … (same command)
 * Before:   GOAL_PAGES=<pages built from another commit> … serves those pages instead of building.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { WORKER_ID_STATE_KEY } from "@flow-state-dev/workforce/browser";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, goalTmpDir, intentFreeEnv, runGoal } from "../../lib/index.mts";
import { SHIFT_MANAGER_COMMAND, servedAddresses, workerOf } from "../../lib/shift-manager.mts";
import { launchChromium } from "../../lib/playwright.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
/** Each control's source modules, and the module under `controls/` that stands in for all of them. */
const SWAPS = {
  // The conversation hook, and the send path its composer calls: both, so the reply is drawn and nothing is sent.
  "optimistic-reply": { modules: [join("src", "lib", "conversation.ts"), join("src", "lib", "send.ts")], with: "optimistic-reply.ts" },
  "static-brief": { modules: [join("src", "lib", "derive.ts")], with: "static-brief.ts" },
} as const;
type Control = keyof typeof SWAPS;
if (CONTROL === "list") {
  console.log(`controls: ${Object.keys(SWAPS).join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !Object.hasOwn(SWAPS, CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(SWAPS).join(", ")}`);
  process.exit(2);
}

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SHIFT_MANAGER = join(REPO_ROOT, "packages", "shift-manager");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SCRATCH = goalTmpDir("shift-manager-cos");
const LABS = {
  desk: { config: join(HERE, "lab", "fsdev.config.mts"), tree: join(HERE, "lab", "workforce") },
  "no-cos": { config: join(HERE, "lab-no-cos", "fsdev.config.mts"), tree: join(HERE, "lab-no-cos", "workforce") },
} as const;
type LabName = keyof typeof LABS;
/** The seat Shift Manager talks to (D2's rule, read off the fixture tree below, never assumed). */
const COS_NAME = "chief-of-staff";
/** How long a line to the chief of staff may take to settle: a real model answers it. */
const SEND_MS = 120_000;
/** The keys any of which lets the fixture's model resolve. */
const MODEL_KEYS = ["AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- building Shift Manager --------------------------------------------------------

async function buildShiftManager(control: string): Promise<string> {
  const outDir = join(SCRATCH, `pages-${control === "" ? "as-written" : control}`);
  const viteEntry = createRequire(join(SHIFT_MANAGER, "package.json")).resolve("vite");
  const vite = (await import(pathToFileURL(viteEntry).href)) as { build(config: Record<string, unknown>): Promise<unknown> };
  const spec = control === "" ? undefined : SWAPS[control as Control];
  const swap = spec === undefined ? undefined : { targets: spec.modules.map((m) => join(SHIFT_MANAGER, m)), with: join(HERE, "controls", spec.with) };
  const swapped = new Set<string>();
  await vite.build({
    root: SHIFT_MANAGER,
    configFile: join(SHIFT_MANAGER, "vite.config.ts"),
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
    define: { __STATIC_SEATS__: "[]" },
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
                if (resolved === null || !swap.targets.includes(resolved.id)) return null;
                swapped.add(resolved.id);
                return swap.with;
              },
            },
          ],
  });
  const missed = swap?.targets.filter((target) => !swapped.has(target)) ?? [];
  if (missed.length > 0) throw new Error(`control ${control}: the build never imported ${missed.join(", ")}, so nothing was swapped there`);
  return outDir;
}

// ---- serving a Lab -----------------------------------------------------------

type Running = { origin: string; child: ChildProcess; exited: Promise<void> };

async function startLab(name: LabName, pages: string): Promise<Running> {
  mkdirSync(join(SCRATCH, "labs"), { recursive: true });
  const workDir = mkdtempSync(join(SCRATCH, "labs", `${name}-`));
  let log = "";
  const child = spawn(TSX, [SHIFT_MANAGER_COMMAND, "--config", LABS[name].config, "--port", "0", "--no-open", "--assets", pages], {
    cwd: workDir,
    env: intentFreeEnv(process.env, { INIT_CWD: workDir, GOAL_CONTROL: "" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (log += String(d)));
  child.stderr!.on("data", (d) => (log += String(d)));
  let gone = false;
  const exited = new Promise<void>((resolve) =>
    child.on("exit", () => {
      gone = true;
      resolve();
    }),
  );
  for (let waited = 0; waited < 120_000; waited += 250) {
    const served = servedAddresses(log);
    if (served !== undefined) return { origin: served.origin, child, exited };
    if (gone) break;
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`Shift Manager's command never served ${name}. Log tail:\n${log.slice(-2000)}`);
}

// ---- the store, read by this script -----------------------------------------

type Item = { id: string; type: string; role?: string; requestId?: string; suspensionId?: string; content?: unknown };

function labApi(origin: string, bearer: string | undefined) {
  const enc = encodeURIComponent;
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${origin}/api/flows${path}`, {
      method,
      headers: { "content-type": "application/json", ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
  };
  const get = async (path: string): Promise<any> => {
    const { status, body } = await call("GET", path);
    if (status !== 200) throw new Error(`GET ${path}: ${status} ${JSON.stringify(body)}`);
    return body;
  };
  /** Every item of `types` in one session, in stored order. */
  const items = async (sessionId: string, types: string): Promise<Item[]> => {
    const out: Item[] = [];
    for (let offset = 0, page = 0; page < 50; page += 1) {
      const body = await get(`/sessions/${enc(sessionId)}/state?include_items=true&item_types=${types}&offset=${offset}&limit=200`);
      out.push(...(body.items ?? []));
      if (body.pagination?.hasMore !== true) break;
      offset = body.pagination.nextOffset ?? offset + 200;
    }
    return out;
  };
  /** The person's sessions, dispatch runs included. */
  const sessions = async (userId: string): Promise<Array<{ id: string; state?: Record<string, unknown>; parentSessionId?: string | null; createdAt: number }>> =>
    (await get(`/sessions?userId=${enc(userId)}&include=dispatch-runs`)).sessions ?? [];
  /** The suspension ids still pending in `sessionIds`, asking a person. */
  const pendingAsks = async (sessionIds: string[]): Promise<string[]> => {
    const out: string[] = [];
    for (const id of sessionIds) {
      const all = await items(id, "suspension,suspension_resume");
      const resumed = new Set(all.filter((it) => it.type === "suspension_resume").map((it) => it.suspensionId));
      out.push(...all.filter((it) => it.type === "suspension" && !resumed.has(it.suspensionId)).map((it) => it.suspensionId!));
    }
    return out;
  };
  /** A board's rows as stored. */
  const rows = async (mailboxId: string, boardRef: string): Promise<Array<{ status: string }>> =>
    ((await get(`/sessions/${enc(mailboxId)}/resources/${enc(boardRef)}?limit=200`)).items ?? []).map((r: any) => ({ status: String(r.clientData?.status) }));
  return { call, items, sessions, pendingAsks, rows };
}

/** The text of a message item. */
const textOf = (item: Item) => JSON.stringify(item.content ?? "");

// ---- the page ----------------------------------------------------------------

async function open(page: Page, origin: string, path: string) {
  await page.goto(`${origin}${path}`);
  await page.getByTestId("shell").waitFor({ timeout: 20_000 });
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

const needsYouOnScreen = async (page: Page): Promise<number> => {
  const text = await page.getByTestId("cos-summary-asks").textContent();
  if (text?.startsWith("Nothing needs you")) return 0;
  return Number(await page.getByTestId("cos-needs-you").textContent());
};
const asksOnScreen = (page: Page): Promise<string[]> =>
  page.getByTestId("cos-ask").evaluateAll((els) => els.map((e) => e.getAttribute("data-suspension-id") ?? ""));

/** Wait for `read` to return `want`, or the last value read. */
async function settle<T>(read: () => Promise<T>, want: (value: T) => boolean, ms = 10_000): Promise<T> {
  let value = await read();
  for (const until = Date.now() + ms; !want(value) && Date.now() < until; await sleep(200)) value = await read();
  return value;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

// ---- the goal ----------------------------------------------------------------

await runGoal(async (failures) => {
  if (!MODEL_KEYS.some((key) => (process.env[key] ?? "") !== "")) {
    return {
      failures: [`[desk] precondition: the chief of staff runs a real model, and none of ${MODEL_KEYS.join(", ")} is set, so nothing here was checked`],
      evidence: "",
    };
  }
  const desk = await readDeclaredRoster(LABS.desk.tree);
  const cosSeat = desk.workers.find((w) => w.id.split(".").at(-1) === COS_NAME);
  const asker = desk.workers.find((w) => w.declared.flow === "asker");
  const mailbox = desk.mailboxes[0];
  if (cosSeat === undefined || asker === undefined || mailbox === undefined) throw new Error("the desk tree declares no chief of staff, asker or mailbox");
  const boardRefs = ((mailbox.declared.boards as string[] | undefined) ?? []).map((b) => `${mailbox.id}.${b}`);
  const members = new Set((mailbox.declared.members as string[] | undefined) ?? []);

  const pages = process.env.GOAL_PAGES ?? (await buildShiftManager(CONTROL));
  const evidence: string[] = [];
  const served = { desk: await startLab("desk", pages), "no-cos": await startLab("no-cos", pages) };
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.setDefaultTimeout(10_000);

    const leg = async (lab: LabName, run: (fail: (leg: string, why: string) => void) => Promise<void>) => {
      const fail = (name: string, why: string) => failures.push(`[${lab}] ${name}: ${why}`);
      try {
        await run(fail);
      } catch (error) {
        fail("reach", String((error as Error).message ?? error).split("\n")[0]!);
      }
    };

    // ---- the desk ------------------------------------------------------------
    await leg("desk", async (fail) => {
      await page.goto(served.desk.origin);
      const config = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__ ?? null)) as { userId?: string; bearerToken?: string } | null;
      const userId = config?.userId;
      if (userId === undefined) throw new Error("the page was handed no userId");
      const api = labApi(served.desk.origin, config?.bearerToken);

      // Two asks, raised by the person through the asker's own action route: a
      // worker has no flow address of its own, so each runs in a session of the
      // flow its file names, created naming it.
      const askerFlow = String(asker.declared.flow);
      const askSessions = [0, 1].map(() => `s_cos_goal_${randomBytes(3).toString("hex")}`);
      for (const [i, sessionId] of askSessions.entries()) {
        const opened = await api.call("POST", `/${encodeURIComponent(askerFlow)}/sessions`, { userId, sessionId, state: { [WORKER_ID_STATE_KEY]: asker.id } });
        if (opened.status !== 201) throw new Error(`a session with ${asker.id} on "${askerFlow}": ${opened.status} ${JSON.stringify(opened.body)}`);
        const posted = await api.call("POST", `/${encodeURIComponent(askerFlow)}/${encodeURIComponent(sessionId)}/actions/ask`, {
          userId,
          input: { what: `ship part ${i + 1}` },
        });
        if (posted.status !== 202) throw new Error(`raising an ask: ${posted.status} ${JSON.stringify(posted.body)}`);
      }
      const pending = await settle(() => api.pendingAsks(askSessions), (p) => p.length === 2);
      if (pending.length !== 2) throw new Error(`the store holds ${pending.length} pending asks, wanted the 2 raised`);

      // landing
      await open(page, served.desk.origin, "/");
      if ((await page.getByTestId("centre").getAttribute("data-level")) !== "cos") fail("landing", "/ does not draw Chief of Staff");
      if ((await page.getByTestId("nav-cos").getAttribute("aria-current")) !== "page") fail("landing", "the Chief of Staff entry is not current at /");
      const firstEntry = await page.locator("[data-testid=sidebar] [data-testid^=nav-]").first().getAttribute("data-testid");
      if (firstEntry !== "nav-cos") fail("landing", `the sidebar's first entry is ${firstEntry}, not Chief of Staff`);
      await open(page, served.desk.origin, `/nowhere-${randomBytes(2).toString("hex")}`);
      if (!(await visible(page, "cos", 5_000))) fail("landing", "an unknown path does not draw Chief of Staff");

      // summary
      await open(page, served.desk.origin, "/cos");
      await page.getByTestId("cos-summary").waitFor();
      const shownCount = await needsYouOnScreen(page);
      if (shownCount !== pending.length) fail("summary", `the summary says ${shownCount} need you, the store holds ${pending.length} pending`);
      const shownAsks = await asksOnScreen(page);
      if (!same(shownAsks, pending)) fail("summary", `the summary lists [${shownAsks.join(", ")}], the store holds [${pending.join(", ")}]`);
      const storeRunning = (await Promise.all(boardRefs.map((ref) => api.rows(mailbox.id, ref)))).flat().filter((r) => r.status === "in_progress").length;
      const storeNeedsYou = members.has(asker.id) ? pending.length : 0;
      const stream = page.locator(`[data-testid=cos-stream][data-mailbox-id="${mailbox.id}"]`);
      if ((await stream.count()) !== 1) fail("summary", `the rail lists ${mailbox.id} ${await stream.count()} times`);
      else {
        const running = await stream.getByTestId("cos-stream-running").textContent();
        const needs = await stream.getByTestId("cos-stream-needs-you").textContent();
        if (Number(running) !== storeRunning) fail("summary", `${mailbox.id} shows ${running} running, the store holds ${storeRunning}`);
        if (Number(needs) !== storeNeedsYou) fail("summary", `${mailbox.id} shows ${needs} needing you, its members hold ${storeNeedsYou}`);
      }
      evidence.push(`summary ${shownCount} need you / ${pending.length} pending, ${mailbox.id} ${storeRunning} running`);

      // inline
      const answered = shownAsks[0] ?? pending[0]!;
      await page.locator(`[data-testid=cos-ask][data-suspension-id="${answered}"]`).getByRole("button", { name: "Approve" }).click();
      const left = await settle(() => api.pendingAsks(askSessions), (p) => p.length === 1);
      if (left.length !== 1 || left.includes(answered)) fail("inline", `after Approve the store holds [${left.join(", ")}], wanted one fewer, without ${answered}`);
      const after = await settle(() => needsYouOnScreen(page), (n) => n === left.length);
      if (after !== left.length) fail("inline", `after Approve the summary says ${after} need you, the store holds ${left.length}`);
      if ((await asksOnScreen(page)).includes(answered)) fail("inline", `the summary still lists ${answered} once the store has it answered`);
      await page.getByTestId("nav-inbox").click();
      await page.getByTestId("inbox").waitFor();
      const inbox = await page.getByTestId("inbox-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-suspension-id") ?? ""));
      if (!same(inbox, left)) fail("inline", `Inbox lists [${inbox.join(", ")}], the store holds [${left.join(", ")}]`);
      evidence.push(`Approve from the summary: store ${pending.length} → ${left.length}, summary ${shownCount} → ${after}, Inbox ${inbox.length}`);

      // talk
      await page.getByTestId("nav-cos").click();
      const input = page.getByTestId("cos-composer-input");
      await input.waitFor();
      const token = `cos-${randomBytes(4).toString("hex")}`;
      await input.fill(`Please repeat this code back to me exactly: ${token}`);
      /** The person's direct sessions with the seat (the ones naming it as their worker), and the one holding the token's user item. */
      const findLine = async () => {
        for (const session of (await api.sessions(userId)).filter((s) => workerOf(s) === cosSeat.id && s.parentSessionId == null)) {
          const messages = await api.items(session.id, "message");
          const at = messages.findIndex((m) => m.role === "user" && textOf(m).includes(token));
          if (at >= 0) return { sessionId: session.id, messages, at };
        }
        return undefined;
      };
      await page.getByTestId("cos-composer-send").click();
      let state = "";
      let heldAtDelivered: Awaited<ReturnType<typeof findLine>>;
      for (const until = Date.now() + SEND_MS; Date.now() < until; await sleep(50)) {
        state = (await page.getByTestId("cos-composer-status").getAttribute("data-state")) ?? "";
        if (state === "delivered") {
          heldAtDelivered = await findLine();
          break;
        }
        if (["refused", "not-sent", "unconfirmed"].includes(state)) break;
      }
      if (state !== "delivered") {
        const error = await page.getByTestId("cos-composer-error").textContent({ timeout: 100 }).catch(() => null);
        fail("talk", `the composer never read delivered: ${state || "sending"}${error === null ? "" : `, "${error}"`}`);
      } else if (heldAtDelivered === undefined) {
        fail("talk", `delivered was drawn while no session of ${cosSeat.id} held a user item with the token`);
      } else {
        const reply = heldAtDelivered.messages.slice(heldAtDelivered.at + 1).find((m) => m.role === "assistant");
        if (reply === undefined) fail("talk", `${heldAtDelivered.sessionId} holds no assistant item after the line`);
        const drawnIds = async () =>
          (await page.getByTestId("cos-item").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-role")}:${e.getAttribute("data-item-id")}`))) as string[];
        const drawn = await settle(drawnIds, (ids) => reply !== undefined && ids.includes(`assistant:${reply.id}`));
        if (reply !== undefined && !drawn.includes(`assistant:${reply.id}`)) fail("talk", `the screen draws no reply with the stored reply's id ${reply.id}`);
        const stored = new Set(heldAtDelivered.messages.map((m) => m.id));
        const invented = drawn.filter((d) => d.startsWith("assistant:") && !stored.has(d.slice("assistant:".length)));
        if (invented.length > 0) fail("talk", `the screen draws replies the session doesn't hold: ${invented.join(", ")}`);
        evidence.push(`line delivered into ${heldAtDelivered.sessionId} (held when drawn), reply ${reply?.id ?? "none"} drawn by id`);

        // again
        await open(page, served.desk.origin, "/cos");
        const again = await settle(drawnIds, (ids) => reply !== undefined && ids.includes(`assistant:${reply.id}`) && ids.includes(`user:${heldAtDelivered!.messages[heldAtDelivered!.at]!.id}`));
        if (reply === undefined || !again.includes(`assistant:${reply.id}`) || !again.includes(`user:${heldAtDelivered.messages[heldAtDelivered.at]!.id}`)) {
          fail("again", `after a reload the conversation draws [${again.join(", ")}], not the stored line and reply`);
        } else evidence.push(`a reload draws the same line and reply`);
      }
    });

    // ---- A Lab with no chief of staff --------------------------------------------
    await leg("no-cos", async (fail) => {
      await open(page, served["no-cos"].origin, "/");
      if ((await page.getByTestId("centre").getAttribute("data-level")) !== "cos") fail("no CoS", "/ does not draw Chief of Staff");
      if (!(await visible(page, "cos-summary"))) fail("no CoS", "the summary is not drawn");
      if (!(await visible(page, "cos-none"))) fail("no CoS", "no named state says the Lab declares no chief of staff");
      if ((await page.getByTestId("cos-composer").count()) !== 0) fail("no CoS", "a composer is drawn with no chief of staff to talk to");
      evidence.push(`no chief of staff: lands on Chief of Staff, summary and "${(await page.getByTestId("cos-none").textContent().catch(() => ""))?.slice(0, 40)}…"`);
    });

    if (pageErrors.length > 0) failures.push(`[page] reach: the page threw: ${pageErrors.join(" | ")}`);
  } finally {
    await browser.close();
    for (const lab of Object.values(served)) lab.child.kill("SIGTERM");
    await Promise.all(Object.values(served).map((lab) => lab.exited));
  }
  return {
    failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
    evidence: `Shift Manager built with Vite and served by its command over the desk (${cosSeat.id} on the agent kind, a real model) and the desk with no chief of staff; driven in Chromium and graded against the store through each Lab's routes. ${evidence.join("; ")}`,
  };
});
