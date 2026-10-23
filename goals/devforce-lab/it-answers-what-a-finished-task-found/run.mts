/**
 * Goal check — asked "what did we decide?", the Shift Coordinator (the chief
 * of staff) answers from what its own finished task found: the item the
 * coder's scan picked, the plan it proposed, and that the plan still waits on
 * approval, naming the task. It never asks the person to tell it.
 *
 * The DevTeam lab, opened as its profile is served, driven over its HTTP door
 * as the lab's owner. A conversation is opened on the coordinator's flow, a
 * tech-debt scan is dispatched to eng.coder on its board (the
 * `createTask_tasks` action, as an app's screen would), and the coder's run,
 * the lab's stub, answers with a scan report whose pick and plan come after
 * the start a line about the task carries. Once the task has completed and the
 * conversation is quiet, the person asks, as one turn with a real model.
 *
 * Controls:
 *
 *   baseline  this file run on a checkout of main before `readTask` existed
 *             (see goal.md). Must FAIL on reads-the-task and names-the-item.
 *
 * Run: pnpm tsx goals/devforce-lab/it-answers-what-a-finished-task-found/run.mts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelResolver } from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import { DEFAULT_MODEL, gatewayModel, keysServing, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { harnessStub } from "../../../packages/shift-manager/teams/devteam/harness-stub.mts";
import { LAB_USERS, openLab, type Lab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";

interface Fixture {
  scanGoal: string;
  /** The coder's whole answer: the pick and the plan come after the start a task's line carries. */
  report: string;
  /** A word only the pick names. */
  item: string;
  /** Words only the plan names; the reply must carry two of them. */
  planWords: string[];
  ask: string;
}
const fixture = loadFixture<Fixture>(import.meta.url);

const CODER = "eng.coder";
const CHIEF = "chief-of-staff";
const COORDINATOR_FLOW = "coordinator";
const READ_TASK = "getTask";
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const show = (value: unknown, n = 300): string => (JSON.stringify(value) ?? "undefined").slice(0, n);

/** A real model for every turn, and the gateway's evaluation model for the chief of staff's routing. */
function liveResolver(): ModelResolver {
  stripIntentOverrides();
  const base = createModelResolver();
  return Object.assign((_id: string, block?: string, options?: never) => base(gatewayModel(DEFAULT_MODEL), block, options), {
    resolveId: () => gatewayModel(DEFAULT_MODEL),
    resolveEvaluationModel: (id: string, block?: string) => base.resolveEvaluationModel!(id, block),
  }) as unknown as ModelResolver;
}

function textOf(item: { content?: unknown; text?: unknown }): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) return item.content.map((part: { text?: string }) => part.text ?? "").join("");
  return "";
}

function door(lab: Lab) {
  const act = async (sessionId: string, action: string, input: unknown) => {
    const sent = await lab.door("POST", `${COORDINATOR_FLOW}/${encodeURIComponent(sessionId)}/actions/${action}`, {
      as: "owner",
      body: { userId: LAB_USERS.owner.userId, input },
    });
    if (sent.status !== 202) return { requestId: undefined, output: undefined as any, error: `${sent.status} ${show(sent.body)}` };
    const requestId = sent.body.request.id as string;
    for (let i = 0; i < 12_000; i += 1) {
      const status = await lab.door("GET", `${COORDINATOR_FLOW}/requests/${requestId}/status`, { as: "owner" });
      if (status.body?.status !== "in_progress") break;
      await sleep(10);
    }
    const listed = await lab.door("GET", `sessions/${encodeURIComponent(sessionId)}/requests?include_result_output=true&limit=100`, { as: "owner" });
    const found = (listed.body?.requests ?? []).find((r: { id: string }) => r.id === requestId);
    return { requestId: requestId as string | undefined, output: found?.result?.output as any, error: found?.result?.error === undefined ? undefined : show(found.result.error) };
  };
  const open = async () => {
    const sessionId = `s-${COORDINATOR_FLOW}-${globalThis.crypto.randomUUID()}`;
    const created = await lab.door("POST", `${COORDINATOR_FLOW}/sessions`, {
      as: "owner",
      body: { userId: LAB_USERS.owner.userId, sessionId, state: { workerId: CHIEF } },
    });
    if (created.status !== 201) throw new Error(`opening a conversation answered ${created.status}: ${show(created.body)}`);
    return sessionId;
  };
  /** One request's tool outputs and its last assistant message. */
  const turnOf = async (sessionId: string, requestId: string) => {
    const listed = await lab.door("GET", `sessions/${encodeURIComponent(sessionId)}/requests?include_items=true&limit=200`);
    const request = ((listed.body?.requests ?? []) as Array<{ id: string; items?: any[] }>).find((r) => r.id === requestId);
    const items = request?.items ?? [];
    return {
      tools: items
        .filter((item) => item.type === "tool_output")
        .map((item) => ({ name: String(item.toolCall?.name ?? ""), output: item.output ?? item.error ?? null })),
      reply: textOf(items.filter((item) => item.type === "message" && item.role === "assistant").at(-1) ?? {}),
    };
  };
  return { act, open, turnOf };
}

/** Wait until nothing in the lab is running. */
async function quiet(lab: Lab): Promise<void> {
  const runtime = await lab.state.getRuntime();
  for (const deadline = Date.now() + 120_000; Date.now() < deadline; await sleep(50)) {
    const busy = (await runtime.stores.request.list({})).some((r: { status: string }) => ["pending", "queued", "in_progress"].includes(r.status));
    if (!busy) return;
  }
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const note = (assertion: string, why: string): void => {
    failures.push(`${assertion} — ${why}`);
  };
  if (!keysServing(DEFAULT_MODEL).some((key) => (process.env[key] ?? "") !== "")) {
    note("blocked", `no key here serves ${DEFAULT_MODEL}; the check did not run`);
    return { failures, evidence: "" };
  }

  const storefront = createBareRemote("finished-task-storefront", { seed: { "README.md": "Storefront.\n" } });
  const stub = harnessStub({ finalMessage: () => fixture.report });
  const lab = await openLab({
    modelResolver: liveResolver(),
    stores: inMemoryStores(),
    harness: stub.slot,
    runTimeoutMs: 60_000,
    workspace: { root: mkdtempSync(join(tmpdir(), "finished-task-")), remotes: { allow: ["file"] } },
    coderWorkerId: CODER,
    logger: silentLogger,
    inventory: true,
    projects: [{ id: "storefront", title: "Storefront", members: [LAB_USERS.member.userId], repository: storefront.url }],
    // The coder's answer is the stub's fixed report; nothing here grades it.
    withoutJudge: true,
  });
  const http = door(lab);
  try {
    const conversation = await http.open();

    // ---- setup: the scan, dispatched on the conversation's board, completes --
    const filed = await http.act(conversation, "createTask_tasks", {
      goal: fixture.scanGoal,
      assignee: CODER,
      input: { project: { visibility: "shared", id: "storefront" } },
    });
    const taskId = (filed.output?.taskId ?? filed.output?.task?.id) as string | undefined;
    if (filed.error !== undefined || taskId === undefined) throw new Error(`dispatching the scan was refused — ${filed.error ?? show(filed.output)}`);
    let status = "pending";
    for (const deadline = Date.now() + 120_000; Date.now() < deadline && status !== "completed" && status !== "errored"; await sleep(200)) {
      const listed = await http.act(conversation, "listTasks_tasks", {});
      status = ((listed.output?.tasks ?? []) as Array<{ id: string; status: string }>).find((t) => t.id === taskId)?.status ?? status;
    }
    if (status !== "completed") throw new Error(`the scan ended ${status}, not completed; the check can't ask about it`);
    await quiet(lab);

    // ---- the ask: one turn, a real model ------------------------------------
    const turn = await http.act(conversation, "respond", { message: fixture.ask });
    if (turn.requestId === undefined) throw new Error(`the ask was refused — ${turn.error}`);
    const { tools, reply } = await http.turnOf(conversation, turn.requestId);
    const lower = reply.toLowerCase();

    const reads = tools.filter((tool) => tool.name === READ_TASK && (tool.output as { task?: { id?: string } } | null)?.task?.id === taskId);
    if (reads.length === 0) note("reads-the-task", `the turn never read ${taskId} with ${READ_TASK}; it called ${show(tools.map((t) => t.name))}`);
    if (!lower.includes(fixture.item.toLowerCase())) note("names-the-item", `the reply doesn't name the picked item (${fixture.item}): ${show(reply, 600)}`);
    const plan = fixture.planWords.filter((word) => lower.includes(word.toLowerCase()));
    if (plan.length < 2) note("names-the-plan", `the reply names ${show(plan)} of the plan's words ${show(fixture.planWords)}: ${show(reply, 600)}`);
    if (!/(waiting|waits? on|pending|awaiting|not (yet )?(been )?approved|needs? (your )?approval|before (it|anyone|we) start)/i.test(reply)) {
      note("says-it-waits-on-approval", `the reply doesn't say the plan waits on approval: ${show(reply, 600)}`);
    }
    if (!reply.includes(taskId) && !lower.includes(CODER)) note("cites-the-task", `the reply names neither ${taskId} nor ${CODER}: ${show(reply, 600)}`);
    if (/(if you (can )?(tell|let) me|could you (tell|remind) me|let me know what (was|you|we))/i.test(reply)) {
      note("never-asks-the-person", `the reply asks the person for what its board holds: ${show(reply, 600)}`);
    }
    if (failures.length === 0) evidence.push(`task ${taskId}: the turn read it with ${READ_TASK} and answered ${show(reply, 500)}`);
    await quiet(lab);
  } finally {
    await lab.dispose();
  }
  return { failures, evidence: evidence.join("; ") };
});
