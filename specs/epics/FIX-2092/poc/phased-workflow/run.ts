/**
 * FIX-2092 POC harness: phased workflows as a task-filing template, run by
 * today's board on the real engine.
 *
 * Experimental evidence retained with the epic spec. Not production code, not
 * a workspace package, outside every default build, test, lint and fallow scan.
 *
 *   pnpm exec tsx specs/epics/FIX-2092/poc/phased-workflow/run.ts
 *   GOAL_CONTROL=no-fanin pnpm exec tsx specs/epics/FIX-2092/poc/phased-workflow/run.ts   # check 1 must FAIL
 *
 * The shell: a feature worker's flow (`pw-feature`) whose delegation board is
 * a real `taskBoard` over a durable, user-scoped ledger, every assignee a
 * `dispatcher` to a task entry on a worker flow (`pw-worker`), each run in its
 * own child session behind the real claim gate. Workers are deterministic.
 *
 * The host loop stands in for workforce's event wiring and nothing more: on
 * every ending it runs one dispatch pass (`board.drain`, which starts what is
 * ready and exits) and the feature worker's `onTaskSettled`, and after a filing
 * or release one more pass. No new drain mode, no new board mechanics.
 *
 * Every check reads its evidence from the stored rows (the ledger in the
 * resource store) and the record (the feature session's state in the session
 * store), never from what the harness believes.
 */
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "../../../../../packages/core/src/index";
import type { BlockContext } from "../../../../../packages/core/src/types";
import { createFlowState, inMemoryStores, runAction } from "../../../../../packages/engine/src/index";
import type { FlowStateRuntime } from "../../../../../packages/engine/src/index";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type Task,
  type TaskCollectionRef,
  type TaskWorkerInput
} from "../../../../../packages/orchestration/src/tasks";
import { taskBoard, taskLedgers, taskWorkerInputSchema } from "../../../../../packages/orchestration/src/task-board";
import { createMockModelResolver } from "../../../../../packages/testing/src/index";
import { z } from "zod";
import {
  WORKFLOW_STATE_KEY,
  defineWorkflow,
  stepTaskId,
  view,
  type AddStepResult,
  type WorkflowDef,
  type WorkflowRecord,
  type WorkflowRowMeta
} from "./workflow";

const CONTROL = process.env.GOAL_CONTROL;
if (CONTROL !== undefined && CONTROL !== "no-fanin") throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);
const FAN_IN = CONTROL !== "no-fanin";

const USER_ID = "u_phased";
const CELL = `${USER_ID}:~org:${DEFAULT_ORG_ID}`;
const LEDGER = "pw-ledger";
const ledger = Object.assign(defineTaskCollection({ id: LEDGER, scope: "user" }), { id: LEDGER });
const ENTRIES = ["planner", "reviewer", "coder", "gate"] as const;
type Entry = (typeof ENTRIES)[number];

/** The engine narrates every block at debug; keep errors only. */
const quietLogger = { error: (message: string, context?: unknown) => console.error(message, context) };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

let failures = 0;
function check(name: string, ok: boolean, evidence: string[]): void {
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${name}`);
  for (const line of evidence) console.log(`      ${line}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------
// The workflow under test
// ---------------------------------------------------------------------------

/** plan → plan-review ⟨user gate⟩ → implement → review (2 in parallel) ⟨worker gate⟩ → feedback */
function featureWorkflow(options: { workerGate: boolean }): WorkflowDef {
  return {
    name: "feature",
    policy: { loopBackFrom: "review", loopBackTo: "implement", maxLoopBacks: 2 },
    phases: [
      { name: "plan", steps: [{ key: "plan", assignee: "planner" }] },
      { name: "plan-review", steps: [{ key: "plan-review", assignee: "reviewer" }], gate: { by: "user", prompt: "Approve the plan?" } },
      { name: "implement", steps: [{ key: "implement", assignee: "coder" }] },
      {
        name: "review",
        steps: [
          { key: "review-a", assignee: "reviewer" },
          { key: "review-b", assignee: "reviewer" }
        ],
        ...(options.workerGate ? { gate: { by: "worker" as const } } : {})
      },
      { name: "feedback", steps: [{ key: "feedback", assignee: "coder", session: { followUpOf: "implement" } }] }
    ]
  };
}

// ---------------------------------------------------------------------------
// Workers: deterministic, no model
// ---------------------------------------------------------------------------

/** Per-scenario script: which review rounds ask for changes, and how long each entry takes. */
const script = { changesRequested: new Set<string>(), delayMs: { planner: 10, reviewer: 15, coder: 20, gate: 1 } as Record<Entry, number> };

function workerBlock(entry: Entry) {
  return handler({
    name: `pw-${entry}`,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ by: z.string(), session: z.string(), verdict: z.string().optional() }),
    execute: async (input: TaskWorkerInput, ctx) => {
      const key = input.title ?? input.taskId;
      // review-a is the slow one, so a failing review-a ends last: the worst case.
      await sleep(script.delayMs[entry] + (key.startsWith("review-a") ? 25 : 0));
      const out: { by: string; session: string; verdict?: string } = { by: entry, session: ctx.session.identity.id };
      if (entry === "reviewer") out.verdict = script.changesRequested.has(key) ? "changes" : "pass";
      return out;
    }
  });
}

async function ledgerRef(ctx: BlockContext): Promise<TaskCollectionRef> {
  const collection = resolveResourceCollection(ctx, LEDGER);
  if (collection === undefined) throw new Error(`ledger "${LEDGER}" not declared on this flow`);
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: LEDGER, collection }) as Promise<TaskCollectionRef>;
}

const workerFlow = defineFlow({
  kind: "pw-worker",
  actions: {},
  resources: { [LEDGER]: ledger },
  task: {
    actions: Object.fromEntries(
      ENTRIES.map((entry) => [
        entry,
        { block: workerBlock(entry), from: taskLedgers({ name: `pw-door-${entry}`, resolve: async (id: string, ctx: BlockContext) => (id === LEDGER ? ledgerRef(ctx) : undefined) }) }
      ])
    )
  }
})({ id: "pw-worker" });

// ---------------------------------------------------------------------------
// The feature worker's flow: its delegation board, the template, its decisions
// ---------------------------------------------------------------------------

function featureFlow(def: WorkflowDef) {
  const workflow = defineWorkflow(def, { tasks: ledgerRef, ledgerId: LEDGER, fanIn: FAN_IN });

  // The delegation board: every assignee dispatches into a fresh child session
  // (a follow-up row into the session of the task it follows) and the drain
  // exits once nothing it can start is left (FIX-982).
  const board = taskBoard({
    name: "pw-delegation",
    boardId: LEDGER,
    collection: ledger,
    workers: Object.fromEntries(
      ENTRIES.map((entry) => [entry, dispatcher<TaskWorkerInput>({ name: `pw-dispatch-${entry}`, flowKind: "pw-worker", action: entry, session: "per-task" })])
    )
  });

  /**
   * The feature worker's `onTaskSettled`. Looping back is the worker's
   * decision, not the template's: a review round that asked for changes gets a
   * follow-up in implement's session and a re-review round; a round that
   * passed releases the worker gate, if the phase has one.
   */
  const onTaskSettled = handler({
    name: "pw-on-task-settled",
    inputSchema: z.object({ featureTaskId: z.string(), taskId: z.string() }),
    outputSchema: z.object({ decision: z.string(), addSteps: z.array(z.unknown()) }),
    execute: async (input, ctx) => {
      const ref = await ledgerRef(ctx as BlockContext);
      const record = ((ctx.session.state as Record<string, unknown>)[WORKFLOW_STATE_KEY] as Record<string, WorkflowRecord>)[input.featureTaskId]!;
      const meta = ref.get(input.taskId)?.metadata as unknown as WorkflowRowMeta | undefined;
      const policy = record.policy as { loopBackFrom: string; loopBackTo: string; maxLoopBacks: number };
      if (meta === undefined || meta.kind !== "step" || meta.phase !== policy.loopBackFrom) return { decision: "none", addSteps: [] };

      const phase = record.phases.find((p) => p.name === meta.phase)!;
      const rows = phase.stepKeys.map((k) => ref.get(record.steps[k]!)!);
      const round = Math.max(...rows.map((r) => (r.metadata as unknown as WorkflowRowMeta).round));
      const current = rows.filter((r) => (r.metadata as unknown as WorkflowRowMeta).round === round);
      if (current.some((r) => r.status !== "completed")) return { decision: "wait", addSteps: [] };

      const changes = current.filter((r) => (r.output as { verdict?: string } | undefined)?.verdict === "changes");
      if (changes.length > 0 && round <= policy.maxLoopBacks) {
        const next = round + 1;
        const fixKey = `fix-r${next}`;
        const results: AddStepResult[] = [];
        results.push(
          await workflow.addStep(ctx as BlockContext, {
            featureTaskId: input.featureTaskId,
            phase: policy.loopBackTo,
            key: fixKey,
            assignee: "coder",
            session: { followUpOf: "implement" },
            after: [],
            round: next,
            input: { findings: changes.map((r) => r.id) }
          })
        );
        const reviewers = phase.stepKeys.filter((k) => (ref.get(record.steps[k]!)!.metadata as unknown as WorkflowRowMeta).round === 1);
        for (const base of reviewers) {
          results.push(
            await workflow.addStep(ctx as BlockContext, {
              featureTaskId: input.featureTaskId,
              phase: phase.name,
              key: `${base}-r${next}`,
              assignee: "reviewer",
              after: [fixKey],
              round: next
            })
          );
        }
        return { decision: "loop-back", addSteps: results };
      }
      if (phase.gate?.by === "worker") {
        await workflow.releaseGate(ctx as BlockContext, input.featureTaskId, phase.name, `worker:${phase.name}:r${round}`);
        return { decision: "release", addSteps: [] };
      }
      return { decision: "pass", addSteps: [] };
    }
  });

  /** The simulated user's Inbox answer. STAND-IN for FIX-2058's approval. */
  const answerGate = handler({
    name: "pw-answer-gate",
    inputSchema: z.object({ featureTaskId: z.string(), phase: z.string() }),
    outputSchema: z.object({ outcome: z.string() }),
    execute: async (input, ctx) => {
      const out = await workflow.releaseGate(ctx as BlockContext, input.featureTaskId, input.phase, `user:${input.phase}`);
      return { outcome: out.outcome };
    }
  });

  /** Characterization: what a plain re-file of an existing id does on today's durable board. */
  const refileRaw = handler({
    name: "pw-refile-raw",
    inputSchema: z.object({ taskId: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    execute: async (input, ctx) => {
      const ref = await ledgerRef(ctx as BlockContext);
      try {
        await ref.addTask({ id: input.taskId, goal: "again", assignee: "planner", input: {} });
        return { result: "filed a second row" };
      } catch (err) {
        return { result: `threw: ${(err as Error).message}` };
      }
    }
  });

  const flow = defineFlow({
    kind: "pw-feature",
    session: { stateSchema: z.object({ [WORKFLOW_STATE_KEY]: z.record(z.unknown()).optional() }) },
    resources: { [LEDGER]: ledger },
    actions: {
      start: { block: workflow.startBlock },
      dispatch: { block: board.drain },
      onTaskSettled: { block: onTaskSettled },
      answerGate: { block: answerGate },
      refileRaw: { block: refileRaw }
    }
  })({ id: "pw-feature" });
  return { flow, workflow };
}

// ---------------------------------------------------------------------------
// The host: runs a scenario on fresh stores, reading evidence from them
// ---------------------------------------------------------------------------

type Order = "dispatch-first" | "notice-first";

interface Scenario {
  runtime: FlowStateRuntime;
  dispose: () => Promise<void>;
  act: (action: string, input: Record<string, unknown>) => Promise<unknown>;
  rows: () => Promise<Task[]>;
  record: () => Promise<WorkflowRecord | undefined>;
  feature: string;
  passes: number;
  timeline: string[];
  decisions: Array<{ taskId: string; output: { decision: string; addSteps: AddStepResult[] } }>;
  gateEvidence: Array<{ phase: string; passesWhileHeld: number; heldRows: string[]; answeredAt: number }>;
}

async function scenario(name: string, def: WorkflowDef): Promise<Scenario> {
  const { flow } = featureFlow(def);
  const state = createFlowState({
    flows: { "pw-feature": flow, "pw-worker": workerFlow },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
    logger: quietLogger
  });
  const runtime = await state.getRuntime();
  const feature = `feat-${name}`;
  const session = `s_feature_${name}`;
  const s: Scenario = {
    runtime,
    dispose: () => state.dispose(),
    feature,
    passes: 0,
    timeline: [],
    decisions: [],
    gateEvidence: [],
    act: async (action, input) => {
      const res = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: action,
        input,
        userId: USER_ID,
        sessionId: session,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig, logger: quietLogger }
      });
      if (res.error !== undefined) throw new Error(`${action} failed: ${JSON.stringify(res.error)}`);
      if (action === "dispatch") s.passes += 1;
      return (res as { output?: unknown }).output;
    },
    rows: async () => {
      const all = await runtime.stores.resourceState.getByPrefix("user", CELL, `${LEDGER}/`);
      return Object.values(all)
        .map((v) => v.state as unknown as Task)
        .filter((t) => (t.metadata as unknown as WorkflowRowMeta | undefined)?.feature === feature);
    },
    record: async () => {
      const rec = await runtime.stores.session.get(session);
      const st = (rec as { state?: Record<string, unknown> } | undefined)?.state ?? {};
      return (st[WORKFLOW_STATE_KEY] as Record<string, WorkflowRecord> | undefined)?.[feature];
    }
  };
  return s;
}

const ended = (t: Task) => t.status === "completed" || t.status === "errored" || t.status === "cancelled";
const metaOf = (t: Task) => t.metadata as unknown as WorkflowRowMeta;

function showView(s: Scenario, record: WorkflowRecord, rows: Task[]): string {
  const v = view(record, rows);
  const phases = v.phases.map((p) => `${p.name}:${p.status}`).join(" · ");
  const n = Math.min(v.stepN, v.stepM);
  return `step ${n} of ${v.stepM}${v.stepN > v.stepM ? " (all ended)" : ""} | ${phases} | next: ${v.next.join(",") || "-"}${
    v.approvalsWaiting.length > 0 ? ` | approvals waiting: ${v.approvalsWaiting.join(",")}` : ""
  }`;
}

/**
 * Drive the workflow to rest. On each ending: a dispatch pass and the worker's
 * onTaskSettled, in `order`, then one more pass for whatever the notice filed
 * or released. When nothing runs and a user gate is held, the simulated user
 * answers it (if `answer`), and a pass follows.
 */
async function drive(s: Scenario, options: { order: Order; answer: boolean; until?: (rows: Task[]) => boolean; views?: string[] }): Promise<void> {
  const seen = new Set<string>((await s.rows()).filter(ended).map((r) => r.id));
  const snap = async () => {
    const record = await s.record();
    if (record !== undefined && options.views !== undefined) options.views.push(showView(s, record, await s.rows()));
  };
  await s.act("dispatch", {});
  await snap();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const rows = await s.rows();
    if (options.until?.(rows)) return;
    const fresh = rows.filter((r) => ended(r) && !seen.has(r.id)).sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
    if (fresh.length > 0) {
      for (const row of fresh) {
        seen.add(row.id);
        s.timeline.push(`ended ${metaOf(row).step} (${(row.output as { verdict?: string } | undefined)?.verdict ?? row.status})`);
        const notice = async () => {
          const out = (await s.act("onTaskSettled", { featureTaskId: s.feature, taskId: row.id })) as Scenario["decisions"][number]["output"];
          if (out.decision !== "none" && out.decision !== "wait") s.decisions.push({ taskId: row.id, output: out });
        };
        if (options.order === "dispatch-first") {
          await s.act("dispatch", {});
          await notice();
        } else {
          await notice();
        }
        await s.act("dispatch", {});
        await snap();
      }
      continue;
    }
    if (rows.some((r) => r.status === "in_progress")) {
      await sleep(3);
      continue;
    }
    // At rest. A held user gate whose phase ended is an approval waiting.
    const record = await s.record();
    const held = record?.phases.filter((p) => p.gate?.by === "user" && rows.find((r) => r.id === record.steps[p.gate!.key])?.undispatched === true && p.stepKeys.every((k) => rows.find((r) => r.id === record.steps[k])?.status === "completed"));
    if (options.answer && held !== undefined && held.length > 0) {
      const phase = held[0]!;
      // Prove the hold holds: two more passes, and nothing after the gate starts.
      const before = s.passes;
      await s.act("dispatch", {});
      await s.act("dispatch", {});
      const after = await s.rows();
      const downstream = after.filter((r) => (r.deps ?? []).includes(record!.steps[phase.gate!.key]!));
      s.gateEvidence.push({
        phase: phase.name,
        passesWhileHeld: s.passes - before,
        heldRows: downstream.map((r) => `${metaOf(r).step}=${r.status}${r.startedAt === undefined ? "" : "(started!)"}`),
        answeredAt: Date.now()
      });
      s.timeline.push(`user answers ${phase.gate!.key}`);
      await s.act("answerGate", { featureTaskId: s.feature, phase: phase.name });
      await s.act("dispatch", {});
      await snap();
      continue;
    }
    return;
  }
  throw new Error("drive timed out");
}

/** For each phase after the first: did any of its rows start before the previous layer ended? */
function orderViolations(record: WorkflowRecord, rows: Task[]): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: string[] = [];
  const layers: Array<{ label: string; ids: string[] }> = [];
  for (const p of record.phases) {
    layers.push({ label: p.name, ids: p.stepKeys.map((k) => record.steps[k]!) });
    if (p.gate !== undefined) layers.push({ label: p.gate.key, ids: [record.steps[p.gate.key]!] });
  }
  for (let i = 1; i < layers.length; i += 1) {
    const prevEnd = Math.max(...layers[i - 1]!.ids.map((id) => byId.get(id)?.completedAt ?? Number.POSITIVE_INFINITY));
    for (const id of layers[i]!.ids) {
      const r = byId.get(id);
      if (r?.startedAt !== undefined && r.startedAt < prevEnd) {
        out.push(`${metaOf(r).step} started at +${r.startedAt - minStart(rows)}ms, before ${layers[i - 1]!.label} ended at +${prevEnd - minStart(rows)}ms`);
      }
    }
  }
  return out;
}
/** Every row started only after each of its (final, re-wired) deps had ended. Read off the stored rows. */
function depViolations(rows: Task[]): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: string[] = [];
  for (const r of rows) {
    if (r.startedAt === undefined) continue;
    for (const d of r.deps ?? []) {
      const dep = byId.get(d);
      if (dep?.completedAt === undefined || dep.completedAt > r.startedAt) out.push(`${metaOf(r).step} started before its dep ${d.split(":")[1]} ended`);
    }
  }
  return out;
}
const minStart = (rows: Task[]) => Math.min(...rows.map((r) => r.createdAt));

function recordMatchesRows(record: WorkflowRecord, rows: Task[]): string[] {
  const problems: string[] = [];
  const ids = new Set(Object.values(record.steps));
  for (const r of rows) if (!ids.has(r.id)) problems.push(`row ${r.id} is not in the record`);
  for (const [key, id] of Object.entries(record.steps)) {
    const r = rows.find((x) => x.id === id);
    if (r === undefined) problems.push(`record step ${key} has no row`);
    else {
      const phase = record.phases.find((p) => p.stepKeys.includes(key) || p.gate?.key === key);
      if (phase?.name !== metaOf(r).phase) problems.push(`${key}: record phase ${phase?.name} ≠ row phase ${metaOf(r).phase}`);
    }
  }
  if (new Set(rows.map((r) => r.id)).size !== rows.length) problems.push("duplicate row ids");
  return problems;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`FIX-2092 phased-workflow POC${CONTROL ? `   [CONTROL: ${CONTROL}]` : ""}`);

  // ---- Checks 1, 4, 5: the happy path --------------------------------------
  script.changesRequested = new Set();
  {
    const s = await scenario("happy", featureWorkflow({ workerGate: true }));
    const views: string[] = [];
    try {
      await s.act("start", { featureTaskId: s.feature });
      await drive(s, { order: "dispatch-first", answer: true, views });
      const rows = await s.rows();
      const record = (await s.record())!;
      const steps = rows.filter((r) => metaOf(r).kind === "step");
      const violations = [...orderViolations(record, rows), ...depViolations(rows)];
      const a = rows.find((r) => metaOf(r).step === "review-a")!;
      const b = rows.find((r) => metaOf(r).step === "review-b")!;
      const parallel = a.startedAt !== undefined && b.startedAt !== undefined && a.startedAt < (b.completedAt ?? 0) && b.startedAt < (a.completedAt ?? 0);
      const allDone = rows.every((r) => r.status === "completed");
      check("1 · no new runtime: 5 phases run start to finish on today's deps + re-drains, no step starts before the previous phase ends", allDone && violations.length === 0 && parallel, [
        `rows: ${rows.length} (${steps.length} steps + ${rows.length - steps.length} gates), all completed: ${allDone}`,
        `dispatch passes (board.drain runs): ${s.passes}`,
        `review-a ${a.startedAt! - minStart(rows)}→${a.completedAt! - minStart(rows)}ms, review-b ${b.startedAt! - minStart(rows)}→${b.completedAt! - minStart(rows)}ms: parallel=${parallel}`,
        violations.length === 0 ? "no row started before the layer before it ended (startedAt ≥ max completedAt, per stored row)" : `violations: ${violations.join("; ")}`,
        `timeline: ${s.timeline.join(" → ")}`
      ]);

      // Check 4: display from rows + record only.
      const final = view(record, rows);
      const consistent = views.length > 0;
      const sawApproval = views.some((v) => v.includes("approvals waiting: gate-plan-review"));
      const sawStep3 = views.some((v) => v.startsWith("step 3 of 6"));
      check("4 · display: step N of M, per-phase status and next derive from the rows plus the record", consistent && sawApproval && sawStep3 && final.stepM === 6 && final.stepN === 7, [
        "view(record, rows) is pure; each line below is it, over rows read from the resource store and the record read from the session store:",
        ...Array.from(new Set(views)).map((v) => `  ${v}`)
      ]);

      // Check 5: the approval gate.
      const g = s.gateEvidence.find((e) => e.phase === "plan-review");
      const gate = rows.find((r) => metaOf(r).step === "gate-plan-review")!;
      const impl = rows.find((r) => metaOf(r).step === "implement")!;
      const heldOk = g !== undefined && g.passesWhileHeld >= 2 && g.heldRows.every((h) => !h.includes("started"));
      const releasedOk = impl.startedAt !== undefined && gate.completedAt !== undefined && impl.startedAt >= gate.completedAt && gate.startedAt! >= g!.answeredAt;
      check("5 · approval gate (STAND-IN): the next phase waits on a held row until a simulated user answer releases it", heldOk && releasedOk, [
        `gate row ${gate.id}: filed undispatched with deps [${(gate.deps ?? []).join(", ")}]`,
        `while held: ${g?.passesWhileHeld} dispatch passes ran; downstream rows: ${g?.heldRows.join(", ")}`,
        `answer → dispatch(gate) → board ran gate at +${gate.startedAt! - minStart(rows)}ms (after the answer) → implement started at +${impl.startedAt! - minStart(rows)}ms ≥ gate ended at +${gate.completedAt! - minStart(rows)}ms`,
        "stand-in: no held/approval status today; the gate costs a no-op dispatch to a `gate` entry (see README)"
      ]);
    } finally {
      await s.dispose();
    }
  }

  // ---- Check 2: loop-back -------------------------------------------------
  script.changesRequested = new Set(["review-a"]);
  for (const order of ["dispatch-first", "notice-first"] as const) {
    const s = await scenario(`loop-${order}`, featureWorkflow({ workerGate: true }));
    try {
      await s.act("start", { featureTaskId: s.feature });
      const views: string[] = [];
      await drive(s, { order, answer: true, views });
      const rows = await s.rows();
      const byStep = (k: string) => rows.find((r) => metaOf(r).step === k);
      const fix = byStep("fix-r2");
      const impl = byStep("implement")!;
      const reReviews = ["review-a-r2", "review-b-r2"].map(byStep);
      const gate = byStep("gate-review")!;
      const feedback = byStep("feedback")!;
      const pending = rows.filter((r) => !ended(r));
      const early = s.decisions.flatMap((d) => d.output.addSteps.flatMap((a) => a.startedEarly));
      const reviewEnd = Math.max(...rows.filter((r) => metaOf(r).phase === "review" && metaOf(r).kind === "step").map((r) => r.completedAt ?? Infinity));
      // Late steps join a phase after its round-1 rows ran, so phase-by-phase
      // timing can't judge them; their order is their deps. Judge by deps.
      const violations = depViolations(rows);
      const ok =
        fix !== undefined &&
        fix.followUpOf === impl.id &&
        (fix.output as { session?: string })?.session === (impl.output as { session?: string } | undefined)?.session &&
        reReviews.every((r) => r !== undefined && (r.deps ?? []).includes(fix.id) && r.startedAt! >= fix.completedAt!) &&
        reReviews.every((r) => (gate.deps ?? []).includes(r!.id)) &&
        feedback.startedAt! >= reviewEnd &&
        pending.length === 0 &&
        early.length === 0 &&
        violations.length === 0;
      check(`2 · loop-back (${order}): follow-up in implement's session + re-review steps; deps re-wire; nothing pending for good; nothing starts early`, ok, [
        `decisions: ${s.decisions.map((d) => `${d.taskId.split(":")[1]}→${d.output.decision}`).join(", ")}`,
        `fix-r2: followUpOf=${fix?.followUpOf}, session ${(fix?.output as { session?: string })?.session === (impl.output as { session?: string } | undefined)?.session ? "=" : "≠"} implement's (${(impl.output as { session?: string } | undefined)?.session})`,
        `re-reviews deps: ${reReviews.map((r) => `${metaOf(r!).step}←[${r!.deps?.join(",")}]`).join("  ")}`,
        `gate-review deps after re-wire: [${(gate.deps ?? []).join(", ")}]`,
        `feedback started +${feedback.startedAt! - minStart(rows)}ms ≥ last review-phase row ended +${reviewEnd - minStart(rows)}ms; feedback session = implement's: ${(feedback.output as { session?: string } | undefined)?.session === (impl.output as { session?: string } | undefined)?.session}`,
        `rows left pending: ${pending.length}; re-wires refused because the row had started: ${early.length}; rows started before a dep ended: ${violations.length}${violations.length > 0 ? ` (${violations.join("; ")})` : ""}`,
        `timeline: ${s.timeline.join(" → ")}`,
        ...(ok ? [] : rows.map((r) => `row ${metaOf(r).step}: ${r.status}${r.undispatched ? " (held)" : ""} deps=[${(r.deps ?? []).map((d) => d.split(":")[1]).join(",")}]`))
      ]);

      if (order === "dispatch-first") {
        // Check 4b: the display across a loop-back, still rows + record only.
        const unique = Array.from(new Set(views));
        const grew = unique.some((v) => / of 9/.test(v));
        // The first view with M=9 shows the fix running in implement, right after a view where review was running.
        const i = unique.findIndex((v) => / of 9/.test(v));
        const wentBack = i > 0 && unique[i]!.includes("implement:running") && unique[i - 1]!.includes(" of 6") && unique[i - 1]!.includes("review:running");
        check("4b · display across a loop-back: late steps join M (6 → 9) and the current phase moves back to implement", grew && wentBack && unique.at(-1)!.includes("(all ended)"), [
          ...unique.map((v) => `  ${v}`)
        ]);

        // Check 3c: replay after a loop-back keeps the late steps and files nothing.
        const before = rows.length;
        const out = (await s.act("start", { featureTaskId: s.feature })) as { filed: string[] };
        const after = await s.rows();
        const rec2 = (await s.record())!;
        const problems = recordMatchesRows(rec2, after);
        check("3c · replay after a loop-back: start files nothing, the record keeps the late steps and still matches the rows", out.filed.length === 0 && after.length === before && problems.length === 0, [
          `rows before ${before}, after ${after.length}; filed on replay: [${out.filed.join(", ")}]`,
          `record steps: ${Object.keys(rec2.steps).join(", ")}`,
          problems.length === 0 ? "record ↔ rows: every record id has a row, every row is in the record, phases agree" : `mismatch: ${problems.join("; ")}`
        ]);
      }
    } finally {
      await s.dispose();
    }
  }

  // ---- Control for check 2: the plan's shape, without a worker gate --------
  {
    const s = await scenario("loop-naive", featureWorkflow({ workerGate: false }));
    try {
      await s.act("start", { featureTaskId: s.feature });
      await drive(s, { order: "dispatch-first", answer: true });
      const rows = await s.rows();
      const feedback = rows.find((r) => metaOf(r).step === "feedback")!;
      const early = s.decisions.flatMap((d) => d.output.addSteps.flatMap((a) => a.startedEarly));
      const reReviewEnd = Math.max(...rows.filter((r) => metaOf(r).round === 2 && metaOf(r).phase === "review").map((r) => r.completedAt ?? Infinity));
      const startedEarly = early.includes(feedback.id) || (feedback.startedAt ?? Infinity) < reReviewEnd;
      check("2-control · without a worker gate, a dispatch pass that runs before onTaskSettled starts the next phase early (expected)", startedEarly, [
        `feedback started +${(feedback.startedAt ?? NaN) - minStart(rows)}ms; fix-r2 filed +${(rows.find((r) => metaOf(r).step === "fix-r2")?.createdAt ?? NaN) - minStart(rows)}ms; re-review round ended +${reReviewEnd - minStart(rows)}ms`,
        `addStep's re-wire of feedback refused, row already started: ${early.includes(feedback.id)}`,
        `timeline: ${s.timeline.join(" → ")}`
      ]);
    } finally {
      await s.dispose();
    }
  }

  // Characterization: the same plan-shaped workflow when the notice happens to run first.
  {
    const s = await scenario("loop-naive-notice", featureWorkflow({ workerGate: false }));
    try {
      await s.act("start", { featureTaskId: s.feature });
      await drive(s, { order: "notice-first", answer: true });
      const rows = await s.rows();
      const feedback = rows.find((r) => metaOf(r).step === "feedback")!;
      const reReviewEnd = Math.max(...rows.filter((r) => metaOf(r).round === 2 && metaOf(r).phase === "review").map((r) => r.completedAt ?? Infinity));
      const early = s.decisions.flatMap((d) => d.output.addSteps.flatMap((a) => a.startedEarly));
      console.log(
        `\nINFO  without a worker gate, notice before dispatch: feedback started +${(feedback.startedAt ?? NaN) - minStart(rows)}ms, re-review round ended +${reReviewEnd - minStart(rows)}ms, re-wires refused: ${early.length}` +
          ` → ${(feedback.startedAt ?? 0) >= reReviewEnd && early.length === 0 ? "safe in this order only" : "early in this order too"}`
      );
    } finally {
      await s.dispose();
    }
  }

  // ---- Check 3: replays ---------------------------------------------------
  script.changesRequested = new Set();
  {
    const s = await scenario("replay", featureWorkflow({ workerGate: true }));
    try {
      const first = (await s.act("start", { featureTaskId: s.feature })) as { filed: string[] };
      const second = (await s.act("start", { featureTaskId: s.feature })) as { filed: string[]; existing: string[] };
      const rows0 = await s.rows();
      const rec0 = (await s.record())!;
      const p0 = recordMatchesRows(rec0, rows0);
      check("3a · replay before anything runs: a second start files nothing and the record matches the rows", second.filed.length === 0 && rows0.length === first.filed.length && p0.length === 0, [
        `first start filed ${first.filed.length}; second filed ${second.filed.length}, found ${second.existing.length}; rows ${rows0.length}`,
        p0.length === 0 ? "record ↔ rows agree" : `mismatch: ${p0.join("; ")}`
      ]);

      // Run until plan-review has ended, then "crash" and replay.
      await drive(s, { order: "dispatch-first", answer: false, until: (rows) => rows.find((r) => metaOf(r).step === "plan-review")?.status === "completed" });
      const mid = await s.rows();
      const planBefore = mid.find((r) => metaOf(r).step === "plan")!;
      const third = (await s.act("start", { featureTaskId: s.feature })) as { filed: string[] };
      const mid2 = await s.rows();
      const planAfter = mid2.find((r) => metaOf(r).step === "plan")!;
      const p1 = recordMatchesRows((await s.record())!, mid2);
      check("3b · replay mid-run: start files nothing, touches no row, and the record matches the rows", third.filed.length === 0 && mid2.length === mid.length && planAfter.revision === planBefore.revision && planAfter.status === "completed" && p1.length === 0, [
        `rows ${mid.length} → ${mid2.length}; filed: [${third.filed.join(", ")}]; plan: ${planAfter.status}, revision ${planBefore.revision} → ${planAfter.revision}`,
        p1.length === 0 ? "record ↔ rows agree" : `mismatch: ${p1.join("; ")}`
      ]);

      // Characterization: today's durable board on a plain re-file of an id.
      const raw = (await s.act("refileRaw", { taskId: stepTaskId(s.feature, "plan") })) as { result: string };
      console.log(`\nINFO  a plain addTask of an existing id on today's durable ledger: ${raw.result}`);
    } finally {
      await s.dispose();
    }
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASS" : `${failures} CHECK(S) FAILED`}${CONTROL ? `   [CONTROL: ${CONTROL}]` : ""}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
