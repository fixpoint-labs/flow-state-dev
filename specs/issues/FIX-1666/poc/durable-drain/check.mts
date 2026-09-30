/**
 * POC · does a board drain run inside the approved branch of a durable request,
 * after the ask is answered through the engine's own resume route?
 *
 * Throwaway design evidence for FIX-1666 (PLAN.md → At implement time; the premise the sketch rested on).
 * Not production code, not a workspace package, in no default build, test or
 * lint discovery. Nothing outside this folder imports it.
 *
 * Shape under test, with nothing but handlers, the stock suspension and a real
 * task board (no model, no key):
 *
 *   em.ask (durable)  prepare → gate (human_approval) → tapIf approved: file row
 *                     → tapIf approved: board.drain → tapIf rejected: say so
 *   coder.work        the row's recipient, another flow kind (the lab's shape)
 *
 * Driven through the flow router exactly as a client would: dispatch the action,
 * read the pending suspension, POST the resume, poll the request status.
 *
 * Checks, each with the failure it would show:
 *   1. The ask suspends with no row filed and no coder run.
 *   2. The resume route answers 202 before the drain has necessarily finished
 *      (Approve does not hold the person's click for the length of a run).
 *   3. After approve: the request completes, exactly one row, the coder ran it
 *      once, the row settles `completed`, and the coder's child session is
 *      parented under the EM's session.
 *   4. After reject (fresh store): the request completes, no row, no run.
 *   Control: `GOAL_CONTROL=no-gate` files the row before the gate; check 1
 *   must then fail on "a row existed before any approval".
 *
 * Run: pnpm exec tsx specs/issues/FIX-1666/poc/durable-drain/check.mts
 */
import { z } from "zod";
import {
  defineFlow,
  dispatcher,
  handler,
  sequencer,
  SuspensionRejectedError,
} from "../../../../../packages/core/src/index.ts";
import { createFlowState, inMemoryStores } from "../../../../../packages/engine/src/index.ts";
import { createMockModelResolver } from "../../../../../packages/testing/src/index.ts";
import { defineTaskCollection, type TaskWorkerInput } from "../../../../../packages/orchestration/src/tasks/index.ts";
import { taskBoard, taskWorkerInputSchema } from "../../../../../packages/orchestration/src/task-board/index.ts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER_ID = "u_poc_ask";
const EM = "poc-em";
const CODER = "poc-coder";
const BOARD_ID = "poc-feature-board";
const LEDGER_ID = "poc-feature-ledger";
const EM_SESSION = "s_poc_em";
const FEATURE = { issue: "held-out-slug", goal: "a held-out one-line goal" };

const ledger = () => defineTaskCollection({ id: LEDGER_ID, scope: "user" });

function coderFlow(ran: string[]) {
  const worker = handler({
    name: "poc-coder-work",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: (input: TaskWorkerInput) => {
      ran.push(input.taskId);
      return { handled: input.taskId };
    },
  });
  const board = taskBoard({
    name: `${CODER}-board`,
    boardId: BOARD_ID,
    collection: ledger(),
    workers: {
      work: dispatcher<TaskWorkerInput>({ name: `${CODER}-hand-off`, action: "work", session: "per-task" }),
    },
  });
  return defineFlow({
    kind: CODER,
    actions: { drain: { block: board.drain } },
    task: { actions: { work: { block: worker } } },
  })({ id: CODER });
}

function emFlow() {
  const board = taskBoard({
    name: BOARD_ID,
    boardId: BOARD_ID,
    collection: ledger(),
    workers: {
      work: dispatcher<TaskWorkerInput>({
        name: `${EM}-hand-off`,
        flowKind: CODER,
        action: "work",
        session: "per-task",
      }),
    },
  });

  const feature = z.object({ issue: z.string(), goal: z.string() });
  const decision = feature.extend({ approved: z.boolean() });

  const addRow = async (tasks: any, f: z.infer<typeof feature>) => {
    const id = `row-${f.issue}`;
    if ((await tasks.getTask(id)) !== undefined) return;
    await tasks.addTask({ id, goal: f.goal, assignee: "work", input: { issue: f.issue } });
  };

  const prepare = handler({
    name: "poc-em-prepare",
    inputSchema: feature,
    outputSchema: feature,
    uses: [board.capability],
    execute: async (input, ctx) => {
      // The control: file before asking. Check 1 must catch it.
      if (CONTROL === "no-gate") await addRow((ctx as any).cap[BOARD_ID], input);
      return input;
    },
  });

  const gate = handler({
    name: "poc-em-gate",
    inputSchema: feature,
    outputSchema: decision,
    execute: async (input, ctx) => {
      try {
        await ctx.suspend!({
          reason: "human_approval",
          message: `File ${input.issue}: ${input.goal} and start the coder?`,
        });
        return { ...input, approved: true };
      } catch (err) {
        if (err instanceof SuspensionRejectedError) return { ...input, approved: false };
        throw err;
      }
    },
  });

  const file = handler({
    name: "poc-em-file",
    inputSchema: decision,
    uses: [board.capability],
    execute: async (input, ctx) => {
      await addRow((ctx as any).cap[BOARD_ID], input);
    },
  });

  const refused = handler({
    name: "poc-em-refused",
    inputSchema: decision,
    execute: async (input, ctx) => {
      ctx.emit.message(`Nothing filed for ${input.issue}: the ask was denied.`);
    },
  });

  const ask = sequencer({ name: "poc-em-ask", inputSchema: feature })
    .step(prepare)
    .step(gate)
    .tapIf((d) => d.approved, file)
    .tapIf((d) => d.approved, () => ({}), board.drain)
    .tapIf((d) => !d.approved, refused);

  return defineFlow({
    kind: EM,
    actions: {
      ask: { block: ask, durable: true },
      drain: { block: board.drain },
    },
  })({ id: EM });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scenario(answer: "approve" | "reject") {
  const ran: string[] = [];
  const state = createFlowState({
    flows: { [EM]: emFlow(), [CODER]: coderFlow(ran) },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
    durable: true,
  });
  const out: Record<string, unknown> = { answer };
  try {
    const runtime = await state.getRuntime();
    const router = await state.getRouter();
    const call = async (method: "GET" | "POST", segs: string[], body?: unknown) => {
      const req = new Request("http://local/api/flows/" + segs.join("/"), {
        method,
        headers: { "content-type": "application/json", accept: "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const res = await (router as any)[method](req, { params: { path: segs } });
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: res.status, body: json };
    };
    const row = async () =>
      (await runtime.stores.resourceState.get("user", USER_ID, `${LEDGER_ID}/row-${FEATURE.issue}`))?.state as
        | { status?: string }
        | undefined;
    const status = async (requestId: string) => {
      const r = await call("GET", [EM, "requests", requestId, "status"]);
      return r.body?.status ?? r.body?.request?.status;
    };
    const until = async (want: string[], requestId: string) => {
      for (let i = 0; i < 300; i++) {
        const s = await status(requestId);
        if (want.includes(s)) return s;
        await sleep(20);
      }
      return await status(requestId);
    };

    const dispatch = await call("POST", [EM, EM_SESSION, "actions", "ask"], { input: FEATURE, userId: USER_ID });
    const requestId = dispatch.body?.request?.id ?? dispatch.body?.requestId;
    out.dispatchStatus = dispatch.status;
    out.suspendedStatus = await until(["suspended", "failed", "completed"], requestId);
    out.rowBeforeAnswer = (await row()) !== undefined;
    out.ranBeforeAnswer = [...ran];

    const provider = (runtime.runtimeConfig as any).durabilityProvider;
    const pending = (await provider.listSuspended({ status: "pending" })).filter(
      (s: any) => s.requestId === requestId,
    );
    out.pending = pending.map((s: any) => ({ reason: s.reason, status: s.status, message: s.message }));
    const suspensionId = pending[0]?.suspensionId;

    const resume = await call("POST", [EM, "requests", requestId, "resume"], {
      suspensionId,
      action: answer,
      resumedBy: USER_ID,
    });
    out.resumeStatus = resume.status;
    out.ranAtResumeReturn = [...ran];

    out.finalStatus = await until(["completed", "failed"], requestId);
    for (let i = 0; i < 200 && answer === "approve" && (await row())?.status !== "completed"; i++) await sleep(20);
    out.row = (await row()) ?? null;
    out.ran = [...ran];
    const children = await runtime.stores.session.list({ userId: USER_ID, parentage: { parentOf: EM_SESSION } });
    out.children = children.map((c: any) => ({ id: c.id, flowKind: c.flowKind }));
    out.pendingAfter = (await provider.listSuspended({ status: "pending" })).filter(
      (s: any) => s.requestId === requestId,
    ).length;
    const req = await runtime.stores.request.get(requestId);
    out.error = (req as any)?.error ?? null;
  } finally {
    await state.dispose();
  }
  return out;
}

const failures: string[] = [];
const approve = await scenario("approve");
const reject = await scenario("reject");
console.log(JSON.stringify({ control: CONTROL || null, approve, reject }, null, 2));

// 1 · the ask suspends with nothing filed
for (const s of [approve, reject]) {
  if (s.suspendedStatus !== "suspended") failures.push(`${s.answer}: request did not suspend (${s.suspendedStatus})`);
  if (s.rowBeforeAnswer) failures.push(`${s.answer}: a row existed before any approval`);
  if ((s.ranBeforeAnswer as string[]).length > 0) failures.push(`${s.answer}: the coder ran before any answer`);
  if (!(s.pending as any[]).some((p) => p.reason === "human_approval" && p.status === "pending"))
    failures.push(`${s.answer}: no pending human_approval in the EM's session`);
}
// 2 · resume returns 202
for (const s of [approve, reject]) if (s.resumeStatus !== 202) failures.push(`${s.answer}: resume answered ${s.resumeStatus}`);
// 3 · approve runs the board
if (approve.finalStatus !== "completed") failures.push(`approve: request ended ${approve.finalStatus} (${JSON.stringify(approve.error)})`);
if ((approve.ran as string[]).length !== 1) failures.push(`approve: coder ran ${(approve.ran as string[]).length} times`);
if ((approve.row as any)?.status !== "completed") failures.push(`approve: row is ${(approve.row as any)?.status ?? "missing"}`);
if (!(approve.children as any[]).some((c) => c.flowKind === CODER))
  failures.push("approve: no coder child session under the EM's session");
if (approve.pendingAfter !== 0) failures.push("approve: an approval is still pending");
// 4 · reject files nothing
if (reject.finalStatus !== "completed") failures.push(`reject: request ended ${reject.finalStatus}`);
if (reject.row !== null) failures.push("reject: a row was filed");
if ((reject.ran as string[]).length !== 0) failures.push("reject: the coder ran");
if (reject.pendingAfter !== 0) failures.push("reject: an approval is still pending");

if (failures.length > 0) {
  console.log(`FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS");
