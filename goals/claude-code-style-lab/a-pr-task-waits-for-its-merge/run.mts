/**
 * Goal check: in the Claude Code-style lab, a coding task whose run opened a
 * pull request stays open until the pull request merges or closes, shows
 * *PR open · #7* with its link and keeps its composer, takes a line or a
 * delivered message as one more run on the same attempt, and settles only on
 * what GitHub says when woken. What this run proves is `goal.md` beside it.
 *
 * Model-free: the lab on `fsdev dev --app`, its coding tasks on harness-manager's
 * scripted coder (`CLAUDE_CODE_STYLE_HARNESS=stub`), and a stub `gh` first on the
 * server's PATH (`bin/gh`) that lists PR 7 on the run's branch once the run did
 * its work, and answers `repos/acme/app/pulls/7` from a state file each leg
 * sets, logging every call. A delivered message goes through this folder's
 * `mail.mts`, a stand-in for the service that will deliver one.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command), each a scratch patch applied
 * as the server loads (`goals/lib/module-patch`), never written to the checkout:
 *   - `no-wait`: the lab's managers built without `awaitPullRequests`. Must FAIL a:open.
 *   - `ignore-pr-state`: every wake reads its pull requests as merged. Must FAIL
 *     b:waits-again and d:cancelled.
 *   - `plain-steer`: a board steer is kept as a plain steer, leaving the wait open
 *     (orchestration's `steerWrite` before it answered an external wait). Must FAIL
 *     b:line:waits-again: the view's box sends a board steer, never the run's door.
 *
 * Run: pnpm tsx goals/claude-code-style-lab/a-pr-task-waits-for-its-merge/run.mts
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@flow-state-dev/client";
import { goalTmpDir, loadFixture, REPO_ROOT, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { crashAndRestart } from "../../lib/server.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { boardOf, buildPages, labCheckout, makeRepository, openSessionOn, sleep, startLab, until } from "../lab.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const fixture = loadFixture<{ project: string; title: string; goal: string; closedTitle: string; closedGoal: string; line: string; message: { from: string; text: string }; unreadableLine: string; mergedLine: string; closedLine: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER = "u_goal";
/** The scripted coder's pause before each of its five steps. */
const STEP_MS = 300;
/** How long a run, its checks and its settle have to land a row where a leg looks. */
const SETTLE_MS = 90_000;
/** The first step the scripted coder narrates: one per harness run, in the run session's items. */
const FIRST_STEP = "Reading the worker's instructions, brief and conventions.";
const prUrl = (n: number) => `https://github.com/acme/app/pull/${n}`;

const PATCHES: Record<string, ModulePatch[]> = {
  "no-wait": [{ module: "labs/claude-code-style/workforce/flows/harness-thread.mts", from: "awaitPullRequests: true,", to: "awaitPullRequests: false," }],
  "ignore-pr-state": [
    {
      module: "packages/harness-manager/src/manager.ts",
      from: String.raw`const reads = await readTaskPullRequests\(ctx, prs\);`,
      to: `const reads = { read: prs.map((pr) => ({ ...pr, state: "merged" })) };`,
    },
  ],
  "plain-steer": [
    {
      module: "packages/orchestration/src/tasks/steers.ts",
      from: String.raw`const wait = task.status === "in_progress" \? externalHoldOf\(task\) : undefined;`,
      to: `const wait = undefined as ReturnType<typeof externalHoldOf>;`,
    },
  ],
};
if (CONTROL !== "" && PATCHES[CONTROL] === undefined) throw new Error(`unknown GOAL_CONTROL ${CONTROL}; known: ${Object.keys(PATCHES).join(", ")}`);

type GhPr = { match: string; state: "open" | "merged" | "closed" };

await runGoal(async (failures, tell) => {
  const labBefore = labCheckout();
  const scratch = goalTmpDir("claude-code-style-pr-wait");
  const data = join(scratch, "data");
  const ghState = join(scratch, "gh-state.json");
  const ghLog = join(scratch, "gh-calls.log");
  writeFileSync(ghLog, "");
  const prs: Record<number, GhPr> = {};
  let ghFails = false;
  const setGh = () => writeFileSync(ghState, JSON.stringify({ prs, fail: ghFails }));
  setGh();
  const ghCalls = () => readFileSync(ghLog, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as { args: string[]; code: number });
  const reads = (n: number) => ghCalls().filter((c) => c.args.at(-1)?.endsWith(`/pulls/${n}`)).length;

  const mark = join(scratch, "patched.log");
  const patches = PATCHES[CONTROL] ?? [];
  if (patches.length > 0) console.error(`control ${CONTROL}:\n${describePatches(patches, REPO_ROOT)}`);
  const env = {
    CLAUDE_CODE_STYLE_HARNESS: "stub",
    CLAUDE_CODE_STYLE_HARNESS_STEP_MS: String(STEP_MS),
    PATH: `${join(HERE, "bin")}:${process.env.PATH ?? ""}`,
    GOAL_GH_STATE: ghState,
    GOAL_GH_LOG: ghLog,
    GOAL_FLOWS: join(HERE, "mail.mts"),
    AI_GATEWAY_API_KEY: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENROUTER_API_KEY: "",
    ...(patches.length > 0 ? modulePatchEnv(patches, REPO_ROOT, mark) : {}),
  };
  const notes: string[] = [];
  let lab: Awaited<ReturnType<typeof startLab>> | undefined;
  let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    buildPages();
    const repo = makeRepository(join(scratch, "repo"), { "NOTES.md": "# Notes\n" });
    const port = 45_000 + Math.floor(Math.random() * 10_000);
    lab = await startLab(data, USER, { ...env, CLAUDE_CODE_STYLE_REPOSITORIES: repo }, undefined, port);
    const fsd = createClient({ userId: USER, baseUrl: lab.origin });
    const { row: rowOf, task: taskOf, file } = boardOf(fsd);

    // ── What the checks read, all through the public client.
    const externalOf = (row: any) => (row?.holds ?? []).find((h: any) => h.actor === "system" && h.ask?.kind === "external");
    /** Harness runs in a run session: the scripted coder narrates its first step once per run. */
    const runsIn = async (sessionId: string) => {
      let count = 0;
      for (let offset = 0; ; ) {
        const page = (await fsd.sessions.state(sessionId, { includeItems: true, offset, limit: 100 })) as { items?: unknown[]; pagination?: { hasMore: boolean; nextOffset: number } };
        count += (page.items ?? []).filter((item) => JSON.stringify(item).includes(FIRST_STEP)).length;
        if (page.pagination?.hasMore !== true) return count;
        offset = page.pagination.nextOffset;
      }
    };
    /** The run session's pull-request record, as the lab's page reads it. */
    const recordIn = async (sessionId: string): Promise<any[]> => {
      const manifest = await fsd.resources.getResourceManifest(sessionId);
      const ref = manifest.resources.find((r) => r.kind === "collection" && r.pattern === "observed-pull-requests/**")?.ref;
      if (ref === undefined) return [];
      return (await fsd.resources.listCollectionItems(sessionId, ref, { limit: 50, topicPrefix: "observed-pull-requests/" })).items.map((i) => i.clientData);
    };
    /** The row once its task waits on a pull request again (a new wait than `before`), or settled. */
    const waitOrSettle = (session: string, id: string, before?: string) =>
      until(async () => {
        const row = await rowOf(session, id);
        if (row === undefined) return undefined;
        if (row.status !== "in_progress") return row;
        const hold = externalOf(row);
        return hold !== undefined && hold.id !== before ? row : undefined;
      }, SETTLE_MS);
    /** A line through the run session's own door, as one typed in that session goes. */
    const door = async (runSession: string, message: string) => {
      const flow = (await fsd.sessions.get(runSession)).flowKind!;
      const sent = await fsd.flow(flow).send("respond", { message }, { sessionId: runSession });
      const { status } = await sent.wait();
      return status;
    };
    const hex = (id: string) => id.replace(/^task_/, "");

    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(30_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(lab.origin);
    const session = await openSessionOn(page, fsd, USER, fixture.project, repo);

    // ── a: the run opens PR 7 and finishes; the task waits on it.
    const t1 = await file(session, fixture.title, fixture.goal);
    prs[7] = { match: hex(t1), state: "open" };
    setGh();
    const first = await waitOrSettle(session, t1);
    if (first === undefined) throw new Error(`setup: task ${t1} neither waited nor settled: ${JSON.stringify(await rowOf(session, t1))}`);
    const waiting = first.value;
    const hold = externalOf(waiting);
    const runSession: string = waiting.run?.sessionId;
    const t1Waits = waiting.status === "in_progress" && hold !== undefined;
    if (!t1Waits) failures.push(`a:open: the row reads ${waiting.status}${hold === undefined ? ", with no external hold" : ""}, not in_progress waiting on its pull request`);
    else if (!(hold.source?.closedBy ?? []).some((r: any) => r.by === "event" && r.event === "pull-request" && String(r.key).endsWith("/7"))) {
      failures.push(`a:open: the external hold names no pull request 7: ${JSON.stringify(hold.source)}`);
    } else notes.push(`a: in_progress on attempt ${waiting.attempts}, hold ${hold.id} on ${hold.source.closedBy.map((r: any) => r.key).join(", ")}`);
    const record = tell.over("a:record · the run session's pull-request rows", await recordIn(runSession));
    if (!record.some((pr) => pr.number === 7 && pr.url === prUrl(7))) failures.push(`a:record: the run session's record has no PR 7 at ${prUrl(7)}: ${JSON.stringify(record)}`);

    const pane = () => page.getByRole("complementary", { name: "Background tasks" });
    const sheet = page.getByRole("dialog", { name: `Work: ${fixture.title}` });
    if (t1Waits) {
      const card = pane().getByRole("button", { name: new RegExp(fixture.title) });
      const cardLine = await card.getByTestId("pull-request-wait").textContent({ timeout: 15_000 }).catch(() => null);
      if (cardLine !== "PR open · #7") failures.push(`a:card: the task's card reads ${JSON.stringify(cardLine)}, not "PR open · #7"`);
      await card.click();
      const link = await sheet.getByRole("link", { name: "#7" }).getAttribute("href", { timeout: 15_000 }).catch(() => null);
      if (link !== prUrl(7)) failures.push(`a:link: the task's view links #7 to ${JSON.stringify(link)}, not the stub's ${prUrl(7)}`);
      const composer = await sheet.getByTestId("task-action-steer-input").isVisible().catch(() => false);
      const hint = await sheet.getByTestId("pull-request-hint").textContent().catch(() => null);
      if (!composer) failures.push("a:composer: the task's view draws no box to type in");
      if (hint !== "Merged? Say so here and I'll check.") failures.push(`a:composer: the view's hint reads ${JSON.stringify(hint)}`);
      if (link === prUrl(7) && composer) notes.push(`a: card "${cardLine}", view links #7 and keeps its box`);
    }

    // ── b: a line typed in the view, then a delivered message: each one run, same attempt and session, then it waits again.
    let holdNow: string | undefined = hold?.id;
    let t1Open = t1Waits;
    const oneRun = async (leg: string, send: () => Promise<unknown>) => {
      const runsBefore = await runsIn(runSession);
      const before = await rowOf(session, t1);
      await send();
      const after = await waitOrSettle(session, t1, holdNow);
      await sleep(2_000); // a second run would show by now
      const row = await rowOf(session, t1);
      const runs = (await runsIn(runSession)) - runsBefore;
      if (after === undefined || row?.status !== "in_progress" || externalOf(row) === undefined) {
        failures.push(`${leg}:waits-again: the row reads ${row?.status}${externalOf(row) === undefined ? " with no open external hold" : ""}, not waiting on its pull request again`);
        t1Open = row?.status === "in_progress";
        return;
      }
      holdNow = externalOf(row).id;
      if (runs !== 1) failures.push(`${leg}:one-run: ${runs} harness runs in the run session, not 1`);
      if (row.attempts !== before?.attempts) failures.push(`${leg}:same-attempt: attempt ${row.attempts}, was ${before?.attempts}`);
      if (row.run?.sessionId !== runSession) failures.push(`${leg}:same-session: the run moved to session ${row.run?.sessionId}`);
      notes.push(`${leg}: ${runs} run, attempt ${row.attempts}, session kept, waiting again (${holdNow})`);
    };
    if (t1Open) {
      await oneRun("b:line", async () => {
        await sheet.getByTestId("task-action-steer-input").fill(fixture.line);
        await sheet.getByTestId("task-action-steer").click();
      });
    } else failures.push("b: not reached, the task never waited");
    if (t1Open) {
      const mailSession = (await fsd.flow("goal-mail").createSession()).id;
      await oneRun("b:message", async () => {
        const sent = await fsd.flow("goal-mail").send("deliver", { toSession: runSession, toFlow: (await fsd.sessions.get(runSession)).flowKind, ...fixture.message }, { sessionId: mailSession });
        await sent.wait();
      });
      const steers = tell.over("b:message · the row's steers", ((await taskOf(session, t1))?.steers ?? []) as any[]);
      if (!steers.some((s) => s.from === "service" && s.by === fixture.message.from && s.message === fixture.message.text)) {
        failures.push(`b:message: no steer on the row from "service" by ${fixture.message.from} with the message's words`);
      }
    }

    // ── e: GitHub can't be read: a line runs one run and the task waits again, never settling.
    if (t1Open) {
      ghFails = true;
      setGh();
      await oneRun("e:unreadable", () => door(runSession, fixture.unreadableLine));
      ghFails = false;
      setGh();
    }

    // ── f: the host crashes while the task waits; the wait and its pull request survive.
    if (t1Open) {
      const holdBefore = holdNow;
      lab = await crashAndRestart(lab.child, () => startLab(data, USER, { ...env, CLAUDE_CODE_STYLE_REPOSITORIES: repo }, undefined, port));
      const row = await rowOf(session, t1);
      if (row?.status !== "in_progress" || externalOf(row)?.id !== holdBefore) {
        failures.push(`f:survives: after the crash the row reads ${row?.status} with hold ${externalOf(row)?.id}, not in_progress on ${holdBefore}`);
        t1Open = false;
      } else if (!(await recordIn(runSession)).some((pr) => pr.number === 7)) failures.push("f:survives: the run session's record lost PR 7");
      else notes.push(`f: after the crash still waiting on ${holdBefore}`);
    }

    // ── c: merged; a line completes the task with the PR on its output, and runs nothing.
    if (t1Open) {
      prs[7] = { ...prs[7]!, state: "merged" };
      setGh();
      const runsBefore = await runsIn(runSession);
      const readsBefore = reads(7);
      await door(runSession, fixture.mergedLine);
      const settled = await until(async () => ((await rowOf(session, t1))?.status !== "in_progress" ? true : undefined), SETTLE_MS);
      await sleep(2_000);
      const task = await taskOf(session, t1);
      const runs = (await runsIn(runSession)) - runsBefore;
      if (settled === undefined || task?.status !== "completed") failures.push(`c:completed: the row reads ${task?.status}, not completed`);
      else if (!((task.output?.pullRequests ?? []) as any[]).some((pr) => pr.number === 7 && pr.state === "merged" && pr.url === prUrl(7))) {
        failures.push(`c:completed: the output names no merged PR 7: ${JSON.stringify(task.output?.pullRequests)}`);
      }
      if (runs !== 0) failures.push(`c:no-run: ${runs} harness runs after the merge, not 0`);
      if (reads(7) <= readsBefore) failures.push("c:read: the wake never read PR 7 from gh");
      if (task?.status === "completed" && runs === 0) notes.push(`c: completed with ${JSON.stringify(task.output.pullRequests)}, no run`);
    } else failures.push("c: not reached, the task was not waiting");

    // ── d: a second task's PR closes unmerged; a line cancels it with the reason.
    const t2 = await file(session, fixture.closedTitle, fixture.closedGoal);
    prs[8] = { match: hex(t2), state: "open" };
    setGh();
    const second = await waitOrSettle(session, t2);
    const t2Row = second?.value;
    if (t2Row?.status !== "in_progress" || externalOf(t2Row) === undefined) failures.push(`d:waits: the second task reads ${t2Row?.status}, not waiting on its pull request`);
    else {
      prs[8] = { ...prs[8]!, state: "closed" };
      setGh();
      await door(t2Row.run.sessionId, fixture.closedLine);
      await until(async () => ((await rowOf(session, t2))?.status !== "in_progress" ? true : undefined), SETTLE_MS);
      const task = await taskOf(session, t2);
      if (task?.status !== "cancelled" || task.error !== "its pull request was closed without merging") {
        failures.push(`d:cancelled: the row reads ${task?.status} (${JSON.stringify(task?.error ?? null)}), not cancelled because its pull request was closed without merging`);
      } else notes.push(`d: cancelled, "${task.error}"`);
    }

    if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(" | ")}`);
    notes.push(`gh: ${ghCalls().length} calls`);
    appendFileSync(join(scratch, "notes.log"), notes.join("\n") + "\n");
    return { failures, evidence: notes.join("; ") };
  } finally {
    await browser?.close();
    if (lab !== undefined) stopProcessGroup(lab.child);
    if (patches.length > 0) {
      try {
        assertPatched(patches, REPO_ROOT, mark);
      } catch (error) {
        failures.push(`control ${CONTROL}: ${(error as Error).message}`);
      }
    }
    if (labCheckout() !== labBefore) failures.push("the lab's own checkout changed");
  }
});
