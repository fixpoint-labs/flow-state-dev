/**
 * Goal check: a Tasks-tab row shows what its action actually came to, from
 * what the engine recorded for the request, in every case that broke reading
 * it back from traces and the live stream.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * The subject is the fixture flow (`fixtures/flow.mts`) served by the ordinary
 * `fsdev dev` over `fixtures/fsdev.config.mts`, and read in Chromium on the
 * shipped DevTool bundle. The page talks to the server through a pass-through
 * proxy this file runs; the `no-result` control makes that proxy strip
 * `result` from the session request list, which is what a server that does
 * not record results sends.
 *
 * Legs (every failure line is tagged with its leg):
 *
 *   handover   a transient action refuses; another row's dispatch then takes
 *              the one live stream; the first row still shows the refusal
 *   hook       a refusal with the flow's completion hooks running after it
 *   ref        a success whose value a sequencer holds by reference
 *   suspend    pending while suspended, then the answer the resume gave
 *   hook-fails the action refused, then its completion hook failed the request
 *   api        the session's request list carries each leg's result, output
 *              only with include_result_output
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/devtool-workforce-visibility/reads-a-row-actions-result/run.mts
 * Controls: GOAL_CONTROL=no-result (must FAIL every leg)
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Locator, Page } from "playwright";
import { REPO_ROOT, goalTmpDir, intentFreeEnv, loadFixture, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";

type Answers = {
  handover: string;
  hook: string;
  ref: unknown;
  suspend: string;
  hookFails: { refusal: string; error: string };
};
type Fixture = {
  rows: { handover: string; hook: string; ref: string; suspend: string; hookFails: string };
  answers: Answers;
};

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const SHOTS = goalTmpDir("reads-a-row-actions-result");
const CONFIG = fileURLToPath(new URL("./fixtures/fsdev.config.mts", import.meta.url));
const KIND = "row-results";
const BOARD = "rows";
const USER = "u_row_results";
const SESSION = `s_row_results_${Date.now()}`;

/** Every leg, in the order the check runs them. */
const LEGS = ["handover", "hook", "ref", "suspend", "hook-fails", "api"] as const;
type Leg = (typeof LEGS)[number];

/** The legs each control must redden: all of them. */
const EXPECTED: Record<string, readonly Leg[]> = {
  "no-result": LEGS,
};

const NO_RESULT = "No result recorded for this request.";
/** How long an answer gets to reach the row. The row poll re-reads every 2s. */
const SETTLE_MS = 20_000;

const failures: string[] = [];
const evidence: string[] = [];
function fail(leg: Leg, line: string): void {
  failures.push(`[${leg}] ${line}`);
}

// ---------------------------------------------------------------------------
// The server, and the proxy the page reads it through
// ---------------------------------------------------------------------------

async function waitForHealth(origin: string, child: ChildProcess, log: () => string): Promise<void> {
  let exited = false;
  child.on("exit", () => (exited = true));
  for (let i = 0; i < 240 && !exited; i += 1) {
    try {
      if ((await fetch(`${origin}/healthz`)).status === 200) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the dev server never became ready on ${origin}. Log tail:\n${log().slice(-2000)}`);
}

async function serve(port: number): Promise<{ origin: string; stop: () => void }> {
  const workDir = join(SHOTS, "server");
  mkdirSync(workDir, { recursive: true });
  let log = "";
  const child = spawn(
    join(REPO_ROOT, "node_modules", ".bin", "tsx"),
    [join(REPO_ROOT, "packages", "cli", "bin", "fsdev.ts"), "dev", "--config", CONFIG, "--no-open", "--port", String(port)],
    {
      cwd: workDir,
      env: intentFreeEnv(process.env, {
        ROW_RESULT_ANSWERS: JSON.stringify(fixture.answers),
        FSDEV_DEBUG_ENDPOINTS: "1",
      }),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (chunk) => (log += String(chunk)));
  child.stderr?.on("data", (chunk) => (log += String(chunk)));
  const origin = `http://127.0.0.1:${port}`;
  await waitForHealth(origin, child, () => log);
  return { origin, stop: () => child.kill("SIGTERM") };
}

/** The session request list, which the `no-result` control rewrites. */
const LIST_PATH = /^\/api\/flows\/sessions\/[^/]+\/requests(\?|$)/;

/**
 * A pass-through proxy in front of the server. Everything streams through
 * untouched, except that under `no-result` the session request list loses
 * every `result`: what a server that does not record results sends.
 */
function proxy(target: string, port: number): Promise<{ origin: string; server: Server }> {
  const upstream = new URL(target);
  const server = createServer((req, res) => {
    const rewrite = CONTROL === "no-result" && req.method === "GET" && LIST_PATH.test(req.url ?? "");
    const out = httpRequest(
      { host: upstream.hostname, port: upstream.port, method: req.method, path: req.url, headers: req.headers },
      (answer) => {
        if (!rewrite) {
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        answer.on("data", (chunk: Buffer) => chunks.push(chunk));
        answer.on("end", () => {
          let text = Buffer.concat(chunks).toString("utf8");
          try {
            const body = JSON.parse(text) as { requests?: Array<Record<string, unknown>> };
            for (const entry of body.requests ?? []) delete entry.result;
            text = JSON.stringify(body);
          } catch {
            /* not JSON: pass it on as it came */
          }
          const headers = { ...answer.headers };
          delete headers["content-length"];
          delete headers["content-encoding"];
          res.writeHead(answer.statusCode ?? 502, headers);
          res.end(text);
        });
      },
    );
    out.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(out);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${port}`, server })));
}

// ---------------------------------------------------------------------------
// The driver's own HTTP: filing rows, finding a request, resuming one
// ---------------------------------------------------------------------------

async function json(origin: string, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${origin}/api/flows${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  try {
    return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

type Listed = { id: string; actionName: string; status: string; result?: Record<string, unknown>; items?: any[] };

async function listRequests(origin: string, query: string): Promise<Listed[]> {
  const { status, body } = await json(origin, `/sessions/${SESSION}/requests${query}`);
  if (status !== 200) throw new Error(`listing the session's requests answered ${status}`);
  return body.requests as Listed[];
}

/** File one row with the board's own `addTask`, and read its id off the task-change item it logged. */
async function fileRow(origin: string, goal: string): Promise<string> {
  const posted = await json(origin, `/${KIND}/${SESSION}/actions/addTask_${BOARD}`, {
    method: "POST",
    body: JSON.stringify({ userId: USER, input: { goal } }),
  });
  if (posted.status !== 202) throw new Error(`filing "${goal}" answered ${posted.status}: ${JSON.stringify(posted.body)}`);
  const requestId = String(posted.body?.request?.id);
  for (let waited = 0; waited < 15_000; waited += 100) {
    const entry = (await listRequests(origin, "?include_items=true")).find((request) => request.id === requestId);
    const change = (entry?.items ?? []).find(
      (item) => item?.type === "component" && item?.data?.task?.goal === goal && typeof item?.data?.task?.id === "string",
    );
    if (entry?.status === "completed" && change !== undefined) return String(change.data.task.id);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the row "${goal}" was never filed`);
}

/** The newest request of one action on the session, once it is listed. */
async function requestOf(origin: string, action: string, until: (status: string) => boolean): Promise<Listed | undefined> {
  for (let waited = 0; waited < SETTLE_MS; waited += 100) {
    const found = (await listRequests(origin, "")).find((request) => request.actionName === action);
    if (found !== undefined && until(found.status)) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The DevTool's own navigation and the row's Actions strip
// ---------------------------------------------------------------------------

async function openSession(page: Page): Promise<void> {
  const kindRow = page.locator(`[data-kind="${KIND}"]`);
  if ((await kindRow.getAttribute("aria-expanded")) !== "true") await kindRow.click();
  const instanceRow = page.locator(`[data-instance-id="${KIND}"]`);
  if ((await instanceRow.count()) > 0 && (await instanceRow.getAttribute("aria-expanded")) !== "true") {
    await instanceRow.click();
  }
  await page.locator(`[data-session-id="${SESSION}"]`).click();
  await page.waitForFunction(
    (id) => [...document.querySelectorAll("[title^='Session ID: ']")].some((el) => el.getAttribute("title")?.includes(id)),
    SESSION,
    { timeout: 15_000 },
  );
  await page.getByRole("tab", { name: "Tasks" }).click();
}

/** The row for one task in the active Tasks panel, by its id and nothing else. */
function rowLocator(page: Page, taskId: string): Locator {
  return page.locator(`main [role='tabpanel'][data-state='active'] [data-task-id="${taskId}"]`).first();
}

async function openRow(page: Page, taskId: string): Promise<boolean> {
  const row = rowLocator(page, taskId);
  try {
    await row.waitFor({ timeout: 15_000 });
  } catch {
    return false;
  }
  const toggle = row.locator("button[aria-expanded]").first();
  if ((await toggle.count()) === 0) return false;
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return true;
}

/** Pick the action on the row, check its form carries the row's locked id, and run it. */
async function startFromRow(page: Page, taskId: string, action: string): Promise<string | undefined> {
  if (!(await openRow(page, taskId))) return `row ${taskId} is not on screen, found by its task id`;
  const row = rowLocator(page, taskId);
  const button = row.getByRole("group", { name: "Actions" }).getByRole("button", { name: action, exact: true });
  if ((await button.count()) === 0) return `the row does not offer "${action}"`;
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  const idField = row.locator('[data-field="taskId"] input').first();
  const locked = (await idField.getAttribute("readonly")) !== null || (await idField.isDisabled());
  if ((await idField.inputValue()) !== taskId || !locked) return `"${action}"'s form does not carry the row's id, locked`;
  await row.getByRole("button", { name: /^run$/i }).click();
  return undefined;
}

type Shown = { state: string; text: string };

/** What the row's outcome for `action` reads, once `until` holds (or the last read). */
async function readOutcome(
  page: Page,
  taskId: string,
  action: string,
  until: (shown: Shown) => boolean,
  ms = SETTLE_MS,
): Promise<Shown | undefined> {
  const line = rowLocator(page, taskId).locator(`[data-submission="${action}"] [data-outcome]`).first();
  let last: Shown | undefined;
  for (let waited = 0; waited <= ms; waited += 250) {
    if ((await line.count()) > 0) {
      last = { state: (await line.getAttribute("data-outcome")) ?? "", text: ((await line.textContent()) ?? "").trim() };
      if (until(last)) return last;
    }
    await page.waitForTimeout(250);
  }
  return last;
}

const settled = (shown: Shown) => shown.state !== "pending";

/** Grade one row's settled answer against the one the fixture fixed. */
function grade(leg: Leg, shown: Shown | undefined, want: { state: string; contains: string[] }): void {
  if (shown === undefined) {
    fail(leg, "the row never showed an outcome");
    return;
  }
  if (shown.state !== want.state) {
    fail(leg, `the row reads ${shown.state}: "${shown.text}", not ${want.state}`);
    return;
  }
  const missing = want.contains.filter((part) => !shown.text.includes(part));
  if (missing.length > 0) {
    fail(leg, `the row reads "${shown.text}", without ${missing.map((part) => JSON.stringify(part)).join(", ")}`);
    return;
  }
  if (shown.text.includes(NO_RESULT)) {
    fail(leg, `the row reads "${shown.text}"`);
    return;
  }
  evidence.push(`${leg}: ${shown.state} "${shown.text}"`);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main(): Promise<{ failures: string[]; evidence: string }> {
  if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) throw new Error(`unknown control "${CONTROL}"`);
  // The bundle the shell serves, built here so a stale one cannot be graded.
  execFileSync("pnpm", ["--filter", "@flow-state-dev/devtool", "build:assets"], { cwd: REPO_ROOT, stdio: "inherit" });

  const base = 4300 + Math.floor(Math.random() * 600);
  const server = await serve(base);
  const front = await proxy(server.origin, base + 1);
  let browser: Browser | undefined;
  const answers = fixture.answers;
  try {
    // ---- the subject: five rows on the board, one per leg --------------------
    const ids: Record<keyof Fixture["rows"], string> = {} as never;
    for (const [leg, goal] of Object.entries(fixture.rows) as Array<[keyof Fixture["rows"], string]>) {
      ids[leg] = await fileRow(server.origin, goal);
    }

    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let navigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    await page.goto(front.origin, { waitUntil: "networkidle" });
    await openSession(page);

    // ---- handover, then hook: the second dispatch takes the one stream --------
    const handoverProblem = await startFromRow(page, ids.handover, "handover");
    if (handoverProblem !== undefined) fail("handover", handoverProblem);
    const handoverFirst = await readOutcome(page, ids.handover, "handover", settled);
    const hookProblem = await startFromRow(page, ids.hook, "hook");
    if (hookProblem !== undefined) fail("hook", hookProblem);
    const hookShown = await readOutcome(page, ids.hook, "hook", settled);
    // Graded after the hook leg's dispatch took the stream from it.
    const handoverShown = await readOutcome(page, ids.handover, "handover", settled);
    if (handoverProblem === undefined) {
      if (handoverFirst !== undefined && handoverShown !== undefined && handoverFirst.text !== handoverShown.text) {
        fail("handover", `the row read "${handoverFirst.text}", then "${handoverShown.text}" once the stream moved on`);
      }
      grade("handover", handoverShown, { state: "refused", contains: [answers.handover] });
    }
    if (hookProblem === undefined) grade("hook", hookShown, { state: "refused", contains: [answers.hook] });

    // ---- ref: a success held by reference -----------------------------------
    const refProblem = await startFromRow(page, ids.ref, "ref");
    if (refProblem !== undefined) fail("ref", refProblem);
    else grade("ref", await readOutcome(page, ids.ref, "ref", settled), { state: "ok", contains: [JSON.stringify(answers.ref)] });

    // ---- suspend: pending while suspended, then the resume's answer ----------
    const suspendProblem = await startFromRow(page, ids.suspend, "suspend");
    if (suspendProblem !== undefined) {
      fail("suspend", suspendProblem);
    } else {
      const suspended = await requestOf(server.origin, "suspend", (status) => status === "suspended");
      if (suspended === undefined) {
        fail("suspend", "the action never suspended");
      } else {
        // Give the row two poll cycles to read the suspended request; it must stay pending.
        await page.waitForTimeout(4_500);
        const whileSuspended = await readOutcome(page, ids.suspend, "suspend", () => true, 0);
        if (whileSuspended?.state !== "pending") {
          fail("suspend", `while suspended the row reads ${whileSuspended?.state}: "${whileSuspended?.text}", not pending`);
        }
        const pending = await json(server.origin, `/sessions/${SESSION}/debug/suspensions`);
        const list = Array.isArray(pending.body) ? pending.body : (pending.body?.suspensions ?? []);
        const suspension = list.find((entry: { requestId?: string }) => entry.requestId === suspended.id);
        const resumed = await json(server.origin, `/${KIND}/requests/${suspended.id}/resume`, {
          method: "POST",
          body: JSON.stringify({
            suspensionId: suspension?.suspensionId,
            action: "submit",
            data: { answer: answers.suspend },
            resumedBy: USER,
          }),
        });
        if (resumed.status >= 300) {
          fail("suspend", `the resume answered ${resumed.status}: ${JSON.stringify(resumed.body)}`);
        } else if (whileSuspended?.state === "pending") {
          grade("suspend", await readOutcome(page, ids.suspend, "suspend", settled), {
            state: "ok",
            contains: [answers.suspend],
          });
        }
      }
    }

    // ---- hook-fails: the action refused, then its hook failed the request ----
    const failsProblem = await startFromRow(page, ids.hookFails, "hookFails");
    if (failsProblem !== undefined) fail("hook-fails", failsProblem);
    else {
      grade("hook-fails", await readOutcome(page, ids.hookFails, "hookFails", settled), {
        state: "failed",
        contains: [answers.hookFails.error, answers.hookFails.refusal],
      });
    }
    await page.screenshot({ path: join(SHOTS, "rows.png"), fullPage: true });

    // ---- api: the list the DevTool reads, through the same proxy -------------
    const expected: Record<string, { output: unknown; error?: string; status: string }> = {
      handover: { output: { ok: false, error: answers.handover }, status: "completed" },
      hook: { output: { ok: false, error: answers.hook }, status: "completed" },
      ref: { output: answers.ref, status: "completed" },
      suspend: { output: { ok: true, answer: answers.suspend }, status: "completed" },
      hookFails: { output: { ok: false, error: answers.hookFails.refusal }, error: answers.hookFails.error, status: "failed" },
    };
    const withOutput = await listRequests(front.origin, "?include_result_output=true");
    const summaries = await listRequests(front.origin, "");
    for (const [action, want] of Object.entries(expected)) {
      const full = withOutput.find((request) => request.actionName === action);
      const summary = summaries.find((request) => request.actionName === action);
      if (full === undefined || summary === undefined) {
        fail("api", `the list has no ${action} request`);
        continue;
      }
      const result = full.result as { output?: unknown; error?: { message?: string }; hasOutput?: boolean } | undefined;
      if (full.status !== want.status) fail("api", `${action} lists ${full.status}, not ${want.status}`);
      if (result == null) {
        fail("api", `${action} lists no result`);
        continue;
      }
      if (JSON.stringify(result.output) !== JSON.stringify(want.output)) {
        fail("api", `${action} lists output ${JSON.stringify(result.output)}, not ${JSON.stringify(want.output)}`);
      }
      if (want.error !== undefined && !String(result.error?.message ?? "").includes(want.error)) {
        fail("api", `${action} lists error ${JSON.stringify(result.error)}, not "${want.error}"`);
      }
      const brief = summary.result as { output?: unknown; error?: { message?: string }; hasOutput?: boolean } | undefined;
      if (brief == null || "output" in brief || brief.hasOutput !== true) {
        fail("api", `without the flag, ${action} lists ${JSON.stringify(brief)}: want hasOutput and no output`);
      } else if (want.error !== undefined && !String(brief.error?.message ?? "").includes(want.error)) {
        fail("api", `without the flag, ${action} lists no error`);
      }
    }
    if (!failures.some((line) => line.startsWith("[api]"))) {
      evidence.push("api: all five results listed with include_result_output; without it, status, error and hasOutput only");
    }

    if (navigations !== 1) fail("handover", `the page navigated ${navigations} times; it loads once`);
  } finally {
    await browser?.close();
    front.server.close();
    server.stop();
  }

  if (CONTROL !== "") {
    const red = new Set(failures.map((line) => /^\[([^\]]+)\]/.exec(line)?.[1]));
    const missed = EXPECTED[CONTROL]!.filter((leg) => !red.has(leg));
    const extra = [...red].filter((leg) => leg !== undefined && !EXPECTED[CONTROL]!.includes(leg as Leg));
    const expectedOk = missed.length === 0 && extra.length === 0;
    console.log(
      `control ${CONTROL}: ${expectedOk ? "every expected leg failed, and no other" : `missed ${missed.join(", ") || "none"}; unexpected ${extra.join(", ") || "none"}`}`,
    );
  }
  return { failures, evidence: evidence.join("; ") };
}

await runGoal(main);
