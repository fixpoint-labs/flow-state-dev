/**
 * Goal check: in Shift Manager's DevTeam Lab, a coding task you accept with
 * **Open a PR** stays open until that pull request merges (FIX-2578). The
 * accept pushes the run's branch and opens the pull request; the task then
 * waits on it. A line in the task's session (the composer's send, through the
 * coder's door) is one more run on the same attempt and session, whose commit
 * comes back for your review; Open a PR again pushes it to the same pull
 * request and the task waits again. Once GitHub says merged, a line completes
 * it with no run. What this run proves is `goal.md` beside it.
 *
 * In process: the DevTeam Lab (`openLab`) with `reviewChanges`, served over
 * HTTP for Shift Manager's own reads and sends; the coder on harness-manager's
 * scripted harness; scripted models (the Shift Coordinator files one task, Jev
 * judges it done). Its project, Storefront, names a GitHub-shaped remote that
 * the workspace maps to a local checkout (`checkouts`), whose `origin` is that
 * remote. The GitHub stand-in (`goals/lib/github-stub`) is first on `PATH`: a
 * stub `ssh` takes the landing's push to a local bare repository, a stub `gh`
 * opens and reads the pull request.
 *
 * Control (`GOAL_CONTROL=no-wait`): the coder's managers built without
 * `awaitPullRequests`, a scratch patch applied in a child that loads it. Must
 * FAIL a:open (the accept completes the task).
 *
 * Run: pnpm tsx goals/shift-manager/a-pr-task-waits-for-its-merge/run.mts
 */
// Traces off before anything reads the flag, as the Lab's other in-process checks run it.
process.env.FSDEV_TRACE_OBSERVABILITY = "0";

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { runAction } from "@flow-state-dev/engine";
import { scriptedHarness } from "@flow-state-dev/harness-manager";
import { serve } from "@flow-state-dev/node";
import { createInboxClient, type InboxItem } from "@flow-state-dev/orchestration/inbox";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, loadFixture, modulePatchEnv, runGoal, silentLogger, stripIntentOverrides, type ModulePatch } from "../../lib/index.mts";
import { githubStub, REMOTE, stubPullRequestUrl } from "../../lib/github-stub.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { CODER_FLOW } from "../../../packages/shift-manager/teams/devteam/workforce/flows/workers/coder.mts";
import { LIST_TASKS_ACTION } from "../../../packages/shift-manager/src/lib/conversation-tasks.ts";
import { connect } from "../../../packages/shift-manager/src/lib/connection.ts";
import { createLabReader } from "../../../packages/shift-manager/src/lib/reads.ts";
import { sendTurn } from "../../../packages/shift-manager/src/lib/send.ts";

stripIntentOverrides();

const fixture = loadFixture<{ goal: string; line: string; merged: string }>(import.meta.url);
const CODER = "eng.coder";
const SHIFT_COORDINATOR = "shift-coordinator";
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;
/** How long a run, its judge and its settle have to land a row where a leg looks. */
const SETTLE_MS = 60_000;

// ---- control: a scratch patch, applied in a child that loads it ----------------------

const CONTROLS: Record<string, { patches: ModulePatch[]; must: string[] }> = {
  "no-wait": {
    must: ["a:open"],
    patches: [{ module: "packages/shift-manager/teams/devteam/workforce/flows/workers/coder.mts", from: "awaitPullRequests: true,", to: "awaitPullRequests: false," }],
  },
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const { patches, must } = CONTROLS[CONTROL]!;
  console.error(describePatches(patches, REPO_ROOT));
  const mark = join(goalTmpDir("sm-pr-wait-control"), `patched-${RUN_STAMP}`);
  const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, ...modulePatchEnv(patches, REPO_ROOT, mark) },
    encoding: "utf8",
  });
  process.stdout.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  assertPatched(patches, REPO_ROOT, mark);
  const out = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const failedOn = must.filter((assertion) => /^FAIL/m.test(out) && out.includes(`${assertion}:`));
  console.log(
    failedOn.length > 0
      ? `control ${CONTROL}: failed on ${failedOn.join(", ")}, as it must`
      : `control ${CONTROL}: did NOT fail on any of ${must.join(", ")}, so the check can't see what the control removes`,
  );
  process.exit(failedOn.length > 0 ? 0 : 1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const show = (value: unknown) => JSON.stringify(value);

/** The Shift Coordinator's first turn files one coder task on Storefront; every other step says "Noted." Jev judges it done. */
function models(goal: string): ModelResolver {
  let filed = false;
  const step = (first: () => unknown) =>
    ({
      modelId: "goal/scripted",
      async generate() {
        throw new Error("the owned tool loop calls generateStep");
      },
      generateStep: async () => first(),
    }) as unknown as GeneratorModel;
  const judgment = step(() => {
    if (filed) return { text: "Noted.", finishReason: "stop" };
    filed = true;
    return { toolCalls: [{ toolCallId: "file", toolName: "createTask", args: { goal, assignee: CODER, input: { project: STOREFRONT } } }], finishReason: "tool-calls" };
  });
  const helper = step(() => ({ text: "Noted.", finishReason: "stop" }));
  const jev = {
    specificationVersion: "v4",
    provider: "goal",
    modelId: "goal/jev",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doEvaluate(call: { questions: Record<string, unknown> }) {
      if (!("verdict" in call.questions)) throw new Error("no route in this check");
      return {
        answers: { verdict: { type: "choice", choice: "done" }, why: { type: "choice", choice: "off-target" } },
        usage: { inputTokens: 1, outputTokens: 1 },
        warnings: [],
        providerMetadata: { typesafe: { confidence: { verdict: 0.9 } } },
      };
    },
  };
  return Object.assign((_id: string, block?: string) => (block?.startsWith("coordinator-judgment") ? judgment : helper), {
    resolveId: (id: string) => id,
    resolveEvaluationModel: () => jev,
  }) as unknown as ModelResolver;
}

await runGoal(async (failures, tell) => {
  const scratch = goalTmpDir("sm-pr-wait");
  const github = githubStub(scratch);
  const checkout = github.checkout(join(scratch, "storefront"), { "NOTES.md": "# Notes\n" });
  // The landing's push and gh run as this process's children: the stubs go first on its PATH.
  Object.assign(process.env, github.env);
  const coder = scriptedHarness({ stepEveryMs: 100 });
  mkdirSync(join(scratch, "runs"), { recursive: true });
  const lab = await openLab({
    stores: sqliteStores({ filename: join(scratch, "lab.sqlite") }),
    harness: coder.slot as never,
    runTimeoutMs: 30_000,
    workspace: { root: join(scratch, "runs"), remotes: { allow: [] }, checkouts: [{ remote: REMOTE, checkout, projects: [{ orgId: LAB_ORG_ID, id: STOREFRONT.id }] }] },
    coderWorkerId: CODER,
    inventory: true,
    devtool: true,
    reviewChanges: true,
    sweepIntervalMs: 200,
    projects: [{ id: STOREFRONT.id, title: "Storefront", repository: REMOTE }],
    modelResolver: models(fixture.goal),
    logger: silentLogger,
    log: () => undefined,
  } as never);
  const handle = await serve(lab.state, { host: "127.0.0.1", port: 0, basePath: "/api/flows", handleSignals: false });
  const notes: string[] = [];
  try {
    const devtool = lab.state.meta.devtool!;
    const client = connect({ baseUrl: `http://127.0.0.1:${handle.port}`, userId: devtool.userId ?? LAB_USER_ID, bearerToken: devtool.bearerToken! });
    const runtime = await lab.state.getRuntime();
    const conversation = `s-goal-pr-wait-${RUN_STAMP}`;
    const act = async (action: string, input: unknown) =>
      (await runAction({
        orgId: LAB_ORG_ID,
        flow: runtime.registry.get("coordinator") as FlowInstance,
        actionName: action,
        input,
        userId: LAB_USER_ID,
        sessionId: conversation,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig,
      } as never)) as { output?: any; error?: unknown };
    const task = async (id: string) => {
      const read = await act("getTask_tasks", { id });
      return read.output?.ok === true ? (read.output.task as Record<string, any>) : undefined;
    };
    const until = async (id: string, done: (row: Record<string, any> | undefined) => boolean, ms = SETTLE_MS) => {
      let row = await task(id);
      for (const end = Date.now() + ms; !done(row) && Date.now() < end; row = await task(id)) await sleep(250);
      return row;
    };
    const externalOf = (row: Record<string, any> | undefined) => (row?.holds ?? []).find((h: any) => h.actor === "system" && h.ask?.kind === "external");
    const reviewOf = (row: Record<string, any> | undefined) =>
      row?.status === "in_progress" ? (row.holds ?? []).find((h: any) => h.source?.kind === "suspension" && h.ask?.kind === "review") : undefined;
    const moved = (row: Record<string, any> | undefined) => row === undefined || row.status !== "in_progress" || reviewOf(row) !== undefined || externalOf(row) !== undefined;

    // ---- setup: a conversation files one coder task; its scripted run commits and waits for review.
    const created = await lab.door("POST", "coordinator/sessions", { body: { userId: LAB_USER_ID, sessionId: conversation, state: { workerId: SHIFT_COORDINATOR } } });
    if (created.status !== 201) throw new Error(`setup: opening the conversation answered ${created.status}`);
    const filed = await act("respond", { message: "Please have the coder do this." });
    if (filed.error !== undefined) throw new Error(`setup: the conversation's turn failed: ${show(filed.error)}`);
    let id: string | undefined;
    for (const end = Date.now() + 10_000; id === undefined && Date.now() < end; await sleep(250)) id = ((await act(LIST_TASKS_ACTION, {})).output?.tasks ?? [])[0]?.id;
    if (id === undefined) throw new Error("setup: the conversation filed no task for the coder");
    const held = await until(id, (r) => reviewOf(r) !== undefined || ["completed", "errored", "cancelled"].includes(r?.status));
    if (reviewOf(held) === undefined) throw new Error(`setup: the task never waited for its review: ${show({ status: held?.status, error: held?.error, holds: held?.holds })}`);
    const runSession: string = held!.run.sessionId;
    const runFlow = (await client.sessions.get(runSession)).flowId ?? CODER_FLOW;

    /** Accept the task's review with Open a PR, as Shift Manager's Inbox card answers it, and read the row once it moved on. */
    const openAPr = async (reviewId: string) => {
      const snapshot = await createLabReader(client).read();
      const items = ("inbox" in snapshot && snapshot.inbox?.ok ? snapshot.inbox.value : []) as InboxItem<unknown>[];
      const item = items.find((i) => i.task?.taskId === id);
      if (item === undefined) throw new Error(`Shift Manager's Inbox lists no item for ${id}`);
      await createInboxClient(client).answer(item, { value: { verdict: "accepted", land: "pull-request" } } as never);
      return await until(id!, (r) => moved(r) && reviewOf(r)?.id !== reviewId);
    };
    /** A line in the task's session, as its composer sends it: to the coder's door. */
    const line = (message: string) => sendTurn(client, { sessionId: runSession, flowId: runFlow, door: "respond" }, message);

    // ---- a: Open a PR pushes the run's branch, opens PR 7, and the task waits on it.
    const accepted = await openAPr(reviewOf(held).id);
    const pr = github.pullRequest(7);
    const pushed = execFileSync("git", ["branch", "--list"], { cwd: github.bare, encoding: "utf8" });
    tell.over("a:ssh · the stub ssh's calls", github.sshCalls());
    if (pr === undefined || !pushed.includes(pr.branch ?? "\0")) {
      failures.push(`a:pushed: no pull request 7 opened from a branch pushed to the remote (stub: ${show(github.pullRequests())}; remote branches: ${pushed.trim()}; row: ${show({ status: accepted?.status, output: accepted?.output, holds: accepted?.holds })})`);
    }
    const wait = externalOf(accepted);
    let waiting = false;
    if (accepted?.status !== "in_progress" || wait === undefined) {
      failures.push(`a:open: after Open a PR the row reads ${accepted?.status}${wait === undefined ? ", with no external hold" : ""}, not in_progress waiting on its pull request`);
    } else if (!(wait.source?.closedBy ?? []).some((r: any) => r.by === "event" && r.event === "pull-request" && String(r.key).endsWith("/7"))) {
      failures.push(`a:open: the wait names no pull request 7: ${show(wait.source)}`);
    } else {
      waiting = true;
      notes.push(`a: Open a PR pushed the run's branch and opened #7; in_progress on attempt ${accepted.attempts}, hold ${wait.id}`);
    }

    // ---- b: a line: one run on the same attempt and session, back to review; Open a PR again, waiting on #7 again.
    if (waiting) {
      const runsBefore = coder.runs.length;
      await line(fixture.line);
      const reviewed = await until(id, (r) => r?.status !== "in_progress" || reviewOf(r) !== undefined || (externalOf(r) !== undefined && externalOf(r).id !== wait.id));
      const runs = coder.runs.length - runsBefore;
      if (reviewOf(reviewed) === undefined) {
        failures.push(`b:line: after the line the row reads ${reviewed?.status} with holds ${show(reviewed?.holds ?? [])}, not back on your review of the run it made`);
        waiting = false;
      } else {
        if (runs !== 1) failures.push(`b:one-run: ${runs} harness runs, not 1`);
        if (reviewed!.attempts !== accepted!.attempts) failures.push(`b:same-attempt: attempt ${reviewed!.attempts}, was ${accepted!.attempts}`);
        if (reviewed!.run?.sessionId !== runSession) failures.push(`b:same-session: the run moved to session ${reviewed!.run?.sessionId}`);
        const again = await openAPr(reviewOf(reviewed).id);
        const hold = externalOf(again);
        const opened = Object.keys(github.pullRequests());
        if (again?.status !== "in_progress" || hold === undefined || !(hold.source?.closedBy ?? []).some((r: any) => String(r.key).endsWith("/7"))) {
          failures.push(`b:waits-again: after Open a PR again the row reads ${again?.status}${hold === undefined ? " with no external hold" : ""}, not waiting on PR 7`);
          waiting = false;
        } else {
          if (opened.length !== 1) failures.push(`b:one-pr: the stub holds pull requests ${opened.join(", ")}, not PR 7 alone`);
          notes.push(`b: ${runs} run, attempt ${again.attempts}, session kept, back to review; Open a PR again: waiting on #7 (${hold.id}), ${opened.length} PR`);
        }
      }
    } else failures.push("b: not reached, the task never waited");

    // ---- c: GitHub says merged; a line completes the task with PR 7 on its output, and runs nothing.
    if (waiting) {
      github.set(7, "merged");
      const runsBefore = coder.runs.length;
      await line(fixture.merged);
      const done = await until(id, (r) => r?.status !== "in_progress");
      await sleep(1_000);
      const runs = coder.runs.length - runsBefore;
      if (done?.status !== "completed") failures.push(`c:completed: the row reads ${done?.status}, not completed`);
      else if (!((done.output?.pullRequests ?? []) as any[]).some((p) => p.number === 7 && p.state === "merged" && p.url === stubPullRequestUrl(7))) {
        failures.push(`c:completed: the output names no merged PR 7: ${show(done.output?.pullRequests)}`);
      }
      if (runs !== 0) failures.push(`c:no-run: ${runs} harness runs after the merge, not 0`);
      if (done?.status === "completed" && runs === 0) notes.push(`c: completed with ${show(done.output?.pullRequests)}, no run`);
    } else failures.push("c: not reached, the task was not waiting");

    notes.push(`gh: ${github.ghCalls().length} calls, ssh: ${github.sshCalls().length}`);
    return { failures, evidence: notes.join("; ") };
  } finally {
    await handle.close?.();
    await lab.dispose();
  }
});
