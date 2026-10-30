/**
 * Goal check for FIX-2145. See goal.md.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-shows-worker-token-usage/run.mts
 * Controls: GOAL_CONTROL=from-traces | harness-only | last-attempt-only | cost-always | no-user-filter | ignore-period
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv } from "../../lib/module-patch.mts";
import { launchChromium } from "../../lib/playwright.mts";
import {
  buildShiftManagerPages,
  labRoutes,
  openShiftManager,
  personPage,
  startShiftManager,
  type LabUser,
  type ServedShiftManager,
} from "../../lib/shift-manager.mts";
import { LAB_CROWD, LAB_USERS, PROJECTS_FLOW } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { LIST_TASKS_ACTION } from "../../../packages/shift-manager/src/lib/conversation-tasks.ts";
import { CONTROL_NAMES, CONTROLS, sdkSeam, type Control } from "./controls.mts";

const SCRATCH = goalTmpDir("worker-usage");
const say = (s: string) => console.error(`[worker-usage ${new Date().toISOString().slice(11, 19)}] ${s}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DAY_MS = 24 * 60 * 60 * 1000;

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && !(CONTROL_NAMES as readonly string[]).includes(controlName)) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${CONTROL_NAMES.join(", ")}`);
  process.exit(2);
}
const control: Control | undefined = controlName === "" ? undefined : CONTROLS[controlName as keyof typeof CONTROLS];

/** One person per leg, so each leg reads records only it wrote. */
const PEOPLE = {
  a: { label: "a", ...LAB_CROWD[0]! },
  b: { label: "b", ...LAB_CROWD[1]! },
  c: { label: "c", ...LAB_CROWD[2]! },
  alice: { label: "alice", ...LAB_CROWD[3]! },
  bob: { label: "bob", ...LAB_CROWD[4]! },
  f: { label: "f", ...LAB_CROWD[5]! },
  h: { label: "h", ...LAB_CROWD[6]! },
  operator: { label: "operator", ...LAB_USERS.owner },
  g: { label: "g", ...LAB_USERS.outsider },
  i: { label: "i", ...LAB_USERS.member },
} satisfies Record<string, LabUser & { label: string }>;

type Source = { source: string; kind: string; billing: string | null; inputTokens: number; outputTokens: number; costUsd: number | null; runs: number; unreported: number };
type Row = { worker: string; gone: boolean; tokens: { input: number; output: number }; costUsd: number | null; bySource: Source[] };

/** One Claude Code attempt: its answer, the usage and cost on its result message, and its account. */
const attempt = (answer: string, input: number, output: number, costUsd: number | undefined, account: Record<string, string>) => ({
  answer,
  usage: { input_tokens: input, output_tokens: output },
  ...(costUsd === undefined ? {} : { total_cost_usd: costUsd, costUsd }),
  account,
});
const SUBSCRIPTION = { email: "person@goal.test", subscriptionType: "max" };
const API_KEY = { apiKeySource: "ANTHROPIC_API_KEY" };

await runGoal(async () => {
  const started = Date.now();
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  const scriptedSdk = pathToFileURL(fileURLToPath(new URL("./lab/scripted-sdk.mjs", import.meta.url))).href;
  const patches = [sdkSeam(scriptedSdk), ...(control?.patches ?? [])];
  const patchEnv = modulePatchEnv(patches, REPO_ROOT, mark);
  if (control !== undefined) say(`control ${control.name}: ${control.does}\n${describePatches(control.patches, REPO_ROOT)}`);

  const setupFile = join(SCRATCH, "setup.json");
  const runLog = join(SCRATCH, "runs.log");
  writeFileSync(runLog, "");
  const runs: Record<string, unknown[]> = {};
  const codex: Record<string, unknown> = {};
  const writeSetup = () => writeFileSync(setupFile, JSON.stringify({ log: runLog, runs, codex }));
  writeSetup();
  const ranTimes = (tag: string) => readFileSync(runLog, "utf8").split("\n").filter((l) => l.startsWith(`RUN ${tag} `)).length;

  say("building Shift Manager's pages");
  const pages = await buildShiftManagerPages(join(SCRATCH, "pages"));
  const storeDir = join(SCRATCH, "store");
  mkdirSync(storeDir, { recursive: true });
  const failures: string[] = [];
  const notes: string[] = [];

  /** Start the Lab over the one store, standing as `how` says. */
  const start = async (label: string, how: { now?: number; production?: boolean; harness?: "claude-code" | "codex" }) => {
    const served = await startShiftManager({
      scratch: SCRATCH,
      label,
      config: fileURLToPath(new URL("./lab/fsdev.config.mts", import.meta.url)),
      pages,
      env: {
        WORKER_USAGE_GOAL_STORE: join(storeDir, "lab.sqlite"),
        WORKER_USAGE_GOAL_SETUP: setupFile,
        WORKER_USAGE_GOAL_HARNESS: how.harness ?? "claude-code",
        ...(how.now === undefined ? {} : { WORKER_USAGE_GOAL_NOW: new Date(how.now).toISOString() }),
        ...(how.production === true ? { WORKER_USAGE_GOAL_PRODUCTION: "1" } : {}),
        ...patchEnv,
      },
      timeoutMs: 180_000,
    });
    const stood = /\[worker-usage-goal\] (.*)/.exec(served.log())?.[1] ?? "(no line)";
    say(`${label}: Lab at ${served.origin}; ${stood}`);
    return { served, stood };
  };
  /** Stop a Lab and keep its log. */
  const stop = async (label: string, served: ServedShiftManager) => {
    await served.stop();
    writeFileSync(join(SCRATCH, `${label}.log`), served.log());
  };

  /** The `workerUsage` query, over the Lab's HTTP door, as `person`. It takes no user argument. */
  const query = async (served: ServedShiftManager, person: LabUser, days?: number): Promise<Row[]> => {
    const done = await labRoutes(served.origin, person).act(
      PROJECTS_FLOW,
      `${PROJECTS_FLOW}-own-${person.userId}`,
      "workerUsage",
      days === undefined ? {} : { days },
    );
    if (done.status !== "completed") throw new Error(`workerUsage as ${person.userId} ended ${done.status}: ${done.error ?? ""}`);
    return (done.output as { workers: Row[] }).workers;
  };
  const rowOf = (rows: Row[], worker: string) => rows.find((row) => row.worker === worker);

  /** Two messages to the researcher, a model-only worker, as `person`. */
  const talkToResearcher = async (served: ServedShiftManager, person: LabUser, times: number, tag: string) => {
    const routes = labRoutes(served.origin, person);
    const sessionId = `s-researcher-${tag}-${RUN_STAMP}`;
    const created = await routes.call("POST", "/agent/sessions", { userId: person.userId, sessionId, state: { workerId: "researcher" } });
    if (created.status !== 201) throw new Error(`${tag}: opening the researcher's session answered ${created.status} ${JSON.stringify(created.body)}`);
    for (let n = 0; n < times; n += 1) {
      const said = await routes.act("agent", sessionId, "respond", { message: `Question ${n + 1}.` });
      if (said.status !== "completed") throw new Error(`${tag}: the researcher's turn ended ${said.status}: ${said.error ?? ""}`);
    }
  };

  /** Ask the chief of staff, as `person`, for a task tagged `tag`, and wait for the task to end. */
  const runTask = async (served: ServedShiftManager, person: LabUser, tag: string) => {
    const routes = labRoutes(served.origin, person);
    const sessionId = `s-cos-${tag}-${RUN_STAMP}`;
    const created = await routes.call("POST", "/coordinator/sessions", { userId: person.userId, sessionId, state: { workerId: "shift-coordinator" } });
    if (created.status !== 201) throw new Error(`${tag}: opening the chief of staff's session answered ${created.status} ${JSON.stringify(created.body)}`);
    const said = await routes.act("coordinator", sessionId, "respond", { message: `Please take this on. [[usage:${tag}]]` });
    if (said.status !== "completed") throw new Error(`${tag}: the chief of staff's turn ended ${said.status}: ${said.error ?? ""}`);
    for (const deadline = Date.now() + 180_000; Date.now() < deadline; await sleep(300)) {
      const listed = await routes.act("coordinator", sessionId, LIST_TASKS_ACTION, {});
      const task = (listed.output as { tasks?: Array<Record<string, any>> } | undefined)?.tasks?.[0];
      if (task !== undefined && ["completed", "errored", "failed", "cancelled"].includes(String(task.status))) return task;
    }
    throw new Error(`${tag}: the coder's task never ended`);
  };

  const browser = await launchChromium();
  /** The worker section on Usage as `person` sees it, for `days` (clicked when not the default 7). */
  const view = async (served: ServedShiftManager, person: LabUser, owner: boolean, days = 7) => {
    const { context, page } = await personPage(browser, served.origin, person, owner);
    try {
      await openShiftManager(page, served.origin, "/usage");
      await page.locator("[data-testid=worker-usage]").waitFor({ timeout: 30_000 });
      if (days !== 7) await page.click(`[data-testid=worker-usage-period] button[data-days="${days}"]`);
      await page.locator(`[data-testid=worker-usage][data-days="${days}"]`).waitFor({ timeout: 15_000 });
      await page.waitForFunction(() => document.querySelector("[data-testid=worker-usage-reading]") === null, undefined, { timeout: 15_000 });
      await sleep(500);
      return await page.$eval("[data-testid=usage]", (usage) => {
        const section = usage.querySelector("[data-testid=worker-usage]")!;
        const windowsFirst = [...usage.querySelectorAll("[data-testid=usage-harness], [data-testid=usage-empty], [data-testid=worker-usage]")].map((el) => el.getAttribute("data-testid"));
        return {
          order: windowsFirst,
          text: section.textContent ?? "",
          rows: [...section.querySelectorAll("[data-testid=worker-usage-row]")].map((row) => ({
            worker: row.getAttribute("data-worker"),
            tokens: row.querySelector("[data-testid=worker-usage-tokens]")?.textContent ?? null,
            sources: [...row.querySelectorAll("[data-testid=worker-usage-source]")].map((s) => ({
              source: s.getAttribute("data-source"),
              billing: s.getAttribute("data-billing"),
              name: s.querySelector("[data-testid=worker-usage-source-name]")?.textContent ?? null,
              tokens: s.querySelector("[data-testid=worker-usage-source-tokens]")?.textContent ?? null,
              cost: s.querySelector("[data-testid=worker-usage-cost]")?.textContent ?? null,
            })),
          })),
        };
      });
    } finally {
      await context.close();
    }
  };
  /** The worker section never calls a total what is left. */
  const noQuota = (leg: string, text: string) => {
    if (/\b(left|remaining|limit)\b/i.test(text)) failures.push(`${leg}:usage-not-quota — the worker section says "${text}"`);
    if (!/usage/i.test(text)) failures.push(`${leg}:says-usage — the worker section never says "usage": "${text}"`);
  };

  try {
    // ── Leg g, first half: spend 8 days before now, on a Lab whose clock stands there. ──
    const past = await start("past", { now: Date.now() - 8 * DAY_MS });
    try {
      await talkToResearcher(past.served, PEOPLE.g, 1, "g");
    } finally {
      await stop("past", past.served);
    }

    // ── A restart, at today's clock: legs a, b, c, e, f, h, and g read back. ──
    runs.b = [attempt("Answered b.", 1000, 200, 0.42, SUBSCRIPTION)];
    runs.c = [attempt("Answered c.", 1000, 200, 0.42, API_KEY)];
    runs["e-alice"] = [attempt("Answered.", 1000, 200, undefined, SUBSCRIPTION)];
    runs["e-bob"] = [attempt("Answered.", 500, 100, undefined, SUBSCRIPTION)];
    runs.f = [attempt("", 250, 50, undefined, SUBSCRIPTION), attempt("Answered f.", 1000, 200, undefined, SUBSCRIPTION)];
    runs.h = [attempt("", 100, 0, undefined, SUBSCRIPTION)];
    runs.report = [attempt("", 900, 100, undefined, SUBSCRIPTION)];
    writeSetup();
    const dev = await start("dev", {});
    let firstA: Row | undefined;
    let firstB: Row | undefined;
    let firstC: Row | undefined;
    try {
      if (!dev.stood.includes("traces=on")) failures.push(`setup — the development Lab stood "${dev.stood}"`);

      // a: a model-only worker answers twice, 4 + 4 tokens a call.
      await talkToResearcher(dev.served, PEOPLE.a, 2, "a");
      firstA = rowOf(await query(dev.served, PEOPLE.a), "researcher");
      const aModel = firstA?.bySource.find((s) => s.kind === "model");
      if (firstA?.tokens.input !== 8 || firstA.tokens.output !== 8 || aModel?.runs !== 2) failures.push(`a:16-tokens — the researcher's row is ${JSON.stringify(firstA)}`);
      if (firstA?.costUsd !== null || aModel?.costUsd !== null) failures.push(`a:no-cost — a model call shows a cost: ${JSON.stringify(firstA)}`);
      notes.push(`a: researcher ${JSON.stringify(firstA?.tokens)} by ${JSON.stringify(firstA?.bySource.map((s) => [s.source, s.runs]))}`);

      // b: the coder on Claude Code, on a subscription.
      const bTask = await runTask(dev.served, PEOPLE.b, "b");
      if (bTask.status !== "completed") failures.push(`b:run — the task ended ${bTask.status}: ${bTask.error ?? ""}`);
      const coderOf = (rows: Row[]) => rows.find((row) => row.bySource.some((s) => s.kind === "harness"));
      firstB = coderOf(await query(dev.served, PEOPLE.b));
      const bClaude = firstB?.bySource.find((s) => s.source === "claude-code");
      if (bClaude?.inputTokens !== 1000 || bClaude.outputTokens !== 200 || bClaude.billing !== "subscription") failures.push(`b:1200 — the coder's row is ${JSON.stringify(firstB)}`);
      if (bClaude?.costUsd !== null || firstB?.costUsd !== null) failures.push(`b:no-cost — a subscription run shows a cost: ${JSON.stringify(firstB)}`);
      notes.push(`b: ${firstB?.worker} ${JSON.stringify(bClaude)}`);

      // c: the same on an API key: tokens and the cost Claude Code reported.
      await runTask(dev.served, PEOPLE.c, "c");
      firstC = coderOf(await query(dev.served, PEOPLE.c));
      const cClaude = firstC?.bySource.find((s) => s.source === "claude-code");
      if (cClaude?.inputTokens !== 1000 || cClaude.outputTokens !== 200 || cClaude.billing !== "api-key" || cClaude.costUsd !== 0.42) {
        failures.push(`c:reported-cost — the coder's row is ${JSON.stringify(firstC)}`);
      }
      notes.push(`c: ${firstC?.worker} ${JSON.stringify(cClaude)}`);

      // The view, under the windows, for b and c.
      const bView = await view(dev.served, PEOPLE.b, false);
      const cView = await view(dev.served, PEOPLE.c, false);
      const bShown = bView.rows.flatMap((r) => r.sources).find((s) => s.source === "claude-code");
      const cShown = cView.rows.flatMap((r) => r.sources).find((s) => s.source === "claude-code");
      if (bShown?.cost !== "cost not reported" || !bShown.name?.includes("subscription")) failures.push(`b:no-cost — the view shows ${JSON.stringify(bShown)}`);
      if (cShown?.cost !== "$0.42, reported by Claude Code" || !cShown.name?.includes("API key")) failures.push(`c:reported-cost — the view shows ${JSON.stringify(cShown)}`);
      if (cShown?.tokens !== "1,200 tokens") failures.push(`c:view-tokens — the view shows ${JSON.stringify(cShown)}`);
      if (cView.order.at(-1) !== "worker-usage" || cView.order.length < 2) failures.push(`view:under-the-windows — Usage is laid out ${JSON.stringify(cView.order)}`);
      noQuota("b", bView.text);
      noQuota("c", cView.text);
      notes.push(`view: b ${JSON.stringify(bShown)}; c ${JSON.stringify(cShown)}; order ${JSON.stringify(cView.order)}`);

      // e: Alice and Bob each run the coder; each reads only their own.
      await runTask(dev.served, PEOPLE.alice, "e-alice");
      await runTask(dev.served, PEOPLE.bob, "e-bob");
      const aliceRows = await query(dev.served, PEOPLE.alice);
      const bobRows = await query(dev.served, PEOPLE.bob);
      const total = (rows: Row[]) => rows.reduce((sum, row) => sum + row.tokens.input + row.tokens.output, 0);
      if (total(aliceRows) !== 1200) failures.push(`e:only-alices — Alice reads ${total(aliceRows)} tokens: ${JSON.stringify(aliceRows)}`);
      if (total(bobRows) !== 600) failures.push(`e:only-bobs — Bob reads ${total(bobRows)} tokens: ${JSON.stringify(bobRows)}`);
      notes.push(`e: Alice ${total(aliceRows)}, Bob ${total(bobRows)}`);

      // f: attempt one answers nothing and fails its check; attempt two passes. Both count.
      const fTask = await runTask(dev.served, PEOPLE.f, "f");
      if (fTask.status !== "completed" || ranTimes("f") !== 2) failures.push(`f:setup — the task ended ${fTask.status} after ${ranTimes("f")} attempt(s)`);
      const fRow = coderOf(await query(dev.served, PEOPLE.f));
      const fClaude = fRow?.bySource.find((s) => s.source === "claude-code");
      if ((fClaude?.inputTokens ?? 0) + (fClaude?.outputTokens ?? 0) !== 1500 || fClaude?.runs !== 2) failures.push(`f:1500 — after two attempts the coder's row is ${JSON.stringify(fRow)}`);
      notes.push(`f: ${fTask.status} after ${ranTimes("f")} attempts; ${JSON.stringify(fClaude)}`);

      // h: a task that fails for good; the Error Reporter drafts its report, under the operator.
      const hTask = await runTask(dev.served, PEOPLE.h, "h");
      if (hTask.status === "completed") failures.push(`h:setup — the task tagged h completed`);
      let reporterRow: Row | undefined;
      for (const until = Date.now() + 120_000; Date.now() < until && reporterRow === undefined; await sleep(1_000)) {
        reporterRow = rowOf(await query(dev.served, PEOPLE.operator), "error-reporter");
      }
      const reported = reporterRow?.bySource.find((s) => s.source === "claude-code");
      if (reported === undefined || ranTimes("report") < 1 || reported.inputTokens !== 900 * reported.runs || reported.outputTokens !== 100 * reported.runs) {
        failures.push(`h:under-the-reporter — after ${ranTimes("report")} draft run(s) the operator reads ${JSON.stringify(reporterRow)}`);
      }
      notes.push(`h: task ${hTask.status} after ${ranTimes("h")} attempts; Error Reporter ${JSON.stringify(reported)}`);

      // g, second half: 8 days old, after a restart: in 30 days, not in 7.
      const g7 = await query(dev.served, PEOPLE.g, 7);
      const g30 = await query(dev.served, PEOPLE.g, 30);
      if (rowOf(g7, "researcher") !== undefined) failures.push(`g:not-in-7-days — 7 days reads ${JSON.stringify(g7)}`);
      if (rowOf(g30, "researcher")?.tokens.input !== 4) failures.push(`g:in-30-days — 30 days reads ${JSON.stringify(g30)}`);
      const gView7 = await view(dev.served, PEOPLE.g, false, 7);
      const gView30 = await view(dev.served, PEOPLE.g, false, 30);
      if (gView7.rows.length !== 0) failures.push(`g:not-in-7-days — the view's 7 days shows ${JSON.stringify(gView7.rows)}`);
      if (gView30.rows[0]?.worker !== "researcher") failures.push(`g:in-30-days — the view's 30 days shows ${JSON.stringify(gView30.rows)}`);
      if (!/UTC/.test(gView30.text)) failures.push(`g:utc — the view doesn't say its days are UTC: "${gView30.text}"`);
      notes.push(`g: 7 days ${g7.length} row(s), 30 days ${JSON.stringify(rowOf(g30, "researcher")?.tokens)}; view 7 ${gView7.rows.length}, 30 ${gView30.rows.length}`);
    } finally {
      await stop("dev", dev.served);
    }

    // ── Leg d: a, b and c again, on a production Lab: the same numbers. ──
    runs["b-prod"] = runs.b!;
    runs["c-prod"] = runs.c!;
    writeSetup();
    const prod = await start("production", { production: true });
    try {
      if (!prod.stood.includes("NODE_ENV=production") || !prod.stood.includes("traces=off")) failures.push(`d:setup — the production Lab stood "${prod.stood}"`);
      await talkToResearcher(prod.served, PEOPLE.a, 2, "a-prod");
      await runTask(prod.served, PEOPLE.b, "b-prod");
      await runTask(prod.served, PEOPLE.c, "c-prod");
      const doubled = (row: Row | undefined) => row && { tokens: { input: row.tokens.input * 2, output: row.tokens.output * 2 }, costUsd: row.costUsd === null ? null : Math.round(row.costUsd * 200) / 100 };
      const shape = (row: Row | undefined) => row && { tokens: row.tokens, costUsd: row.costUsd === null ? null : Math.round(row.costUsd * 100) / 100 };
      for (const [leg, person, first] of [["a", PEOPLE.a, firstA], ["b", PEOPLE.b, firstB], ["c", PEOPLE.c, firstC]] as const) {
        const after = rowOf(await query(prod.served, person), first?.worker ?? "");
        if (JSON.stringify(shape(after)) !== JSON.stringify(doubled(first))) {
          failures.push(`d:same-numbers — leg ${leg} in production added ${JSON.stringify(shape(after))} over development's ${JSON.stringify(shape(first))}`);
        }
        notes.push(`d: ${leg} after production ${JSON.stringify(shape(after))}`);
      }
      // g survives a second restart too.
      if (rowOf(await query(prod.served, PEOPLE.g, 30), "researcher")?.tokens.input !== 4) failures.push(`g:in-30-days — after a second restart 30 days lost the record`);
    } finally {
      await stop("production", prod.served);
    }

    // ── Leg i: the coder on Codex with a key: tokens, api-key, no cost. ──
    codex.i = { answer: "Answered i.", usage: { input_tokens: 700, cached_input_tokens: 0, output_tokens: 300 } };
    writeSetup();
    const onCodex = await start("codex", { harness: "codex" });
    try {
      const iTask = await runTask(onCodex.served, PEOPLE.i, "i");
      if (iTask.status !== "completed") failures.push(`i:run — the task ended ${iTask.status}: ${iTask.error ?? ""}`);
      const iRow = (await query(onCodex.served, PEOPLE.i)).find((row) => row.bySource.some((s) => s.source === "codex"));
      const iCodex = iRow?.bySource.find((s) => s.source === "codex");
      if (iCodex?.inputTokens !== 700 || iCodex.outputTokens !== 300 || iCodex.billing !== "api-key") failures.push(`i:codex-tokens — the coder's row is ${JSON.stringify(iRow)}`);
      if (iCodex?.costUsd !== null || iRow?.costUsd !== null) failures.push(`i:no-cost — Codex shows a cost: ${JSON.stringify(iRow)}`);
      const iView = await view(onCodex.served, PEOPLE.i, false);
      const iShown = iView.rows.flatMap((r) => r.sources).find((s) => s.source === "codex");
      if (iShown?.cost !== "cost not reported") failures.push(`i:no-cost — the view shows ${JSON.stringify(iShown)}`);
      notes.push(`i: ${iRow?.worker} ${JSON.stringify(iCodex)}; view ${JSON.stringify(iShown)}`);
    } finally {
      await stop("codex", onCodex.served);
    }
  } finally {
    await browser.close();
  }

  assertPatched(patches, REPO_ROOT, mark);
  if (process.env.GOAL_KEEP_STORE === undefined) rmSync(storeDir, { recursive: true, force: true });
  for (const note of notes) say(note);

  if (control !== undefined) {
    const red = control.assertions.filter((name) => failures.some((f) => f.startsWith(`${name} `)));
    const missed = control.assertions.filter((name) => !red.includes(name));
    failures.unshift(
      missed.length === 0
        ? `control ${control.name}: failed on ${red.join(", ")}, as it must`
        : `control ${control.name}: did NOT fail on ${missed.join(", ")}, so the check can't see what the control removes`,
    );
  }
  return {
    failures,
    evidence: `legs a to i PASS in ${Math.round((Date.now() - started) / 1000)} s`,
  };
});
