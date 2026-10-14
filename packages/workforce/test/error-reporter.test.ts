/**
 * The Error Reporter on the real engine (FIX-1983).
 *
 * What the operator relies on: a failure that stayed failed becomes exactly
 * one report, however often it repeats; nothing files before they answer the
 * preview; a burst can't flood them; a task's failed requests and its ending
 * are one report, not two; the reporter never reports itself; no secret
 * reaches a report; and a person can report a problem by telling the reporter,
 * which takes the same road. Each test fails if that promise breaks.
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import { ensureSessionRecord, runAction } from "@flow-state-dev/engine";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { callerMetadata } from "../src/conversation-board/ledger";
import { markReportOwed, owedReports, REPORTER_FLOW, REPORTER_INTAKE_ENTRY, REPORTER_INTAKE_KEY } from "../src/conversation-board/report-owed";
import {
  createErrorReporter,
  defineErrorReporterFlow,
  defineErrorReporterIntakeFlow,
  ERROR_REPORTER_FLOW,
  ERROR_REPORTER_INTAKE_FLOW,
  REPORT_SESSION_PREFIX,
  type ErrorReporter,
  type ErrorReporterHost,
  type ErrorReporterOptions,
  type ReportRow
} from "../src/error-reporter";
import { workerConfigSchema } from "../src/worker-config";
import type { WorkerInstallation } from "../src/workers/installation";
import { boardWorkers, bootBoardHost, messageOf, ORG, type BoardHost } from "./conversation-board-harness";

const OPERATOR = "olive";
const CONVERSATION = "s_error-reporter";
const SECRET = "sk-live-abcdefghijklmnop1234";

/** Every prompt the stand-in harness was handed, in order. */
type Prompted = { kind: "draft" | "file" | "comment"; prompt: string };

/**
 * A harness that answers like one: a JSON draft, a filed issue, or a comment
 * verdict, by what its prompt asks for. Records what it was asked.
 */
function standInHarness(prompts: Prompted[], options: { closed?: boolean } = {}) {
  return () =>
    handler({
      name: "stand-in-harness",
      inputSchema: z.object({ prompt: z.string() }),
      execute: async (input) => {
        const kind = input.prompt.includes("draft ONE bug report") ? "draft" : input.prompt.includes("File this bug report") ? "file" : "comment";
        prompts.push({ kind, prompt: input.prompt });
        const json =
          kind === "draft"
            ? { title: "Coordinator fails on a project with no repository", summary: "It throws.", stepsToReproduce: ["Send it work"], expected: "It works", actual: "It throws", suspectedCause: "No repo check", questions: ["Which team?"] }
            : kind === "file"
              ? { url: "https://tracker.example/FIX-9", identifier: "FIX-9" }
              : { closed: options.closed === true };
        return {
          source: "stand-in",
          status: "completed",
          sessionId: null,
          url: null,
          dispatchedAt: Date.now(),
          outcome: "finished",
          finalMessage: "```json\n" + JSON.stringify(json) + "\n```",
          usage: null,
          cost: null
        };
      }
    }) as never;
}

/** A worker flow whose door throws what the message says, or answers. */
function breakerFlow(installation: WorkerInstallation) {
  const door = handler({
    name: "breaker-door",
    inputSchema: z.object({ message: z.string() }),
    execute: async (input) => {
      if (input.message.startsWith("throw:")) throw new Error(input.message.slice("throw:".length));
      return "fine";
    }
  });
  return defineFlow({
    kind: "breaker",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { run: { inputSchema: z.object({ message: z.string() }), block: door, userMessage: (i: { message: string }) => i.message } }
  });
}

type Lab = {
  host: BoardHost;
  reporter: ErrorReporter;
  prompts: Prompted[];
  rows: () => Promise<ReportRow[]>;
  asks: () => Promise<SuspensionRecord[]>;
  answer: (ask: SuspensionRecord, data: Record<string, unknown>) => Promise<void>;
  breaks: (message: string, userId?: string) => Promise<void>;
  conversationLines: () => Promise<string[]>;
  open: (flowKind: string, sessionId: string, userId: string, state: Record<string, unknown>) => Promise<unknown>;
};

let open: BoardHost | undefined;
afterEach(async () => {
  await open?.dispose();
  open = undefined;
});

/** A Lab with the reporter on it, bound to the engine the way a Lab binds it. */
async function openLab(options: Partial<ErrorReporterOptions> & { agentAnswer?: ReturnType<typeof mockGenerator>; closed?: boolean } = {}): Promise<Lab> {
  const prompts: Prompted[] = [];
  const { agentAnswer, closed, ...reporterOptions } = options;
  const reporter = createErrorReporter({
    worker: "error-reporter",
    operator: { userId: OPERATOR, orgId: ORG },
    tracker: { project: "shared/storefront" },
    secrets: () => [SECRET],
    log: () => {},
    ...reporterOptions
  });
  const host = bootBoardHost({
    durable: true,
    standard: [
      ...boardWorkers(),
      { id: "eng.breaker", declared: { flow: "breaker" }, body: "", skills: [] },
      { id: "error-reporter", declared: { flow: ERROR_REPORTER_FLOW }, body: "You report errors.", skills: [] }
    ],
    flows: (installation) => ({
      breaker: breakerFlow(installation),
      [ERROR_REPORTER_FLOW]: defineErrorReporterFlow({ reporter, installation, harness: standInHarness(prompts, { closed }) })
    }),
    plainFlows: { [ERROR_REPORTER_INTAKE_FLOW]: (defineErrorReporterIntakeFlow({ reporter }) as any)({ id: ERROR_REPORTER_INTAKE_FLOW }) },
    generators: { "error-reporter-answer": agentAnswer ?? mockGenerator({ script: [] }) },
    errorCapture: (event) => reporter.capture(event)
  });
  open = host;
  const runtime = await host.state.getRuntime();
  const flowOf = (kind: string) => host.instances[kind] as FlowInstance;
  const ensure = (flowKind: string, sessionId: string, userId: string, orgId: string, state: Record<string, unknown>) => {
    const now = Date.now();
    const flow = flowOf(flowKind);
    return ensureSessionRecord(
      runtime.stores,
      sessionId,
      { flow: flow as never, sessionId, principal: { userId, orgId }, state, fromCaller: true, via: "create" },
      () => ({ id: sessionId, flowKind, flowId: flow.id, userId, orgId, version: 0, createdAt: now, updatedAt: now, journal: [] })
    );
  };
  await ensure(ERROR_REPORTER_FLOW, CONVERSATION, OPERATOR, ORG, { workerId: "error-reporter" });
  const bound: ErrorReporterHost = {
    run: async (r) => {
      const result = (await runAction({
        flow: flowOf(r.flowKind),
        actionName: r.action,
        input: r.input,
        userId: r.userId,
        orgId: r.orgId,
        sessionId: r.sessionId,
        source: r.source,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      } as never)) as { status?: string; output?: unknown; error?: unknown };
      return { output: result.output, ...(result.error === undefined ? {} : { error: messageOf(result.error) }) };
    },
    openSession: async (o) => {
      await ensure(o.flowKind, o.sessionId, o.userId, o.orgId, { ...o.state });
    },
    readSession: async (id) => {
      const record = await runtime.stores.session.get(id);
      return record === undefined ? undefined : { id, flowKind: record.flowKind, userId: record.userId, state: (record as { state?: Record<string, unknown> }).state };
    },
    readRequest: async (id) => {
      const record = await runtime.stores.request.get(id);
      return record === undefined ? undefined : { id, actionName: record.actionName, status: record.status, input: (record as { input?: unknown }).input };
    },
    conversationSessionId: CONVERSATION
  };
  await reporter.bind(bound);

  const rows = async () => {
    const result = await bound.run({ flowKind: ERROR_REPORTER_INTAKE_FLOW, action: "reports", input: { op: "all" }, userId: OPERATOR, orgId: ORG, sessionId: "error-report-intake", source: "internal" });
    return ((result.output as { rows?: ReportRow[] }).rows ?? []).filter((row) => row.kind === "report" || row.kind === "storm");
  };
  const asks = async () =>
    ((await runtime.stores.suspensions.list({ status: "pending" })) as SuspensionRecord[]).filter((s) =>
      String((s as { sessionId?: string }).sessionId ?? "").startsWith(REPORT_SESSION_PREFIX) || true
    );
  const answer = async (ask: SuspensionRecord, data: Record<string, unknown>) => {
    const router = await host.state.getRouter();
    const path = [ERROR_REPORTER_FLOW, "requests", ask.requestId, "resume"];
    const res = await (router as any).POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": OPERATOR },
        body: JSON.stringify({ suspensionId: ask.suspensionId, action: "submit", data, resumedBy: OPERATOR })
      }),
      { params: { path } }
    );
    expect(res.status, await res.clone().text()).toBe(202);
    await host.settled();
    await reporter.idle();
  };
  const breaks = async (message: string, userId = "alice") => {
    const sessionId = `breaker-${userId}`;
    await ensure("breaker", sessionId, userId, ORG, { workerId: "eng.breaker" });
    const result = await host.act(userId, sessionId, "run", { message: `throw:${message}` }, "breaker");
    expect(result.error, JSON.stringify(result).slice(0, 600)).toBeDefined();
    await reporter.idle();
  };
  const conversationLines = async () => (await host.messages(CONVERSATION)).map((m) => m.text);
  return {
    host,
    reporter,
    prompts,
    rows,
    asks,
    answer,
    breaks,
    conversationLines,
    open: (flowKind, sessionId, userId, state) => ensure(flowKind, sessionId, userId, ORG, state)
  };
}

describe("a request that settled failed", () => {
  it("becomes one report whatever its ids, waits in Inbox, and files only once the operator answers", async () => {
    const lab = await openLab();
    await lab.breaks('Project "storefront" has no repository (request req_11aa22bb33)');
    await lab.breaks('Project "storefront" has no repository (request req_99ff88ee77)');

    const [row, ...rest] = await lab.rows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ source: "request", count: 2, status: "previewing" });
    // One draft, and nothing filed: the harness was never asked to file.
    expect(lab.prompts.map((p) => p.kind)).toEqual(["draft"]);
    const asks = await lab.asks();
    expect(asks).toHaveLength(1);
    expect(asks[0]!.reason).toBe("human_input");

    await lab.answer(asks[0]!, { decision: "file", instructions: "Put it in the Platform team" });
    expect(lab.prompts.map((p) => p.kind)).toEqual(["draft", "file"]);
    // The operator's answer is folded into what files.
    expect(lab.prompts[1]!.prompt).toContain("Put it in the Platform team");
    const [filed] = await lab.rows();
    expect(filed).toMatchObject({ status: "filed", issue: { identifier: "FIX-9" } });
    expect(await lab.conversationLines()).toContainEqual(expect.stringContaining("Filed FIX-9"));
  });

  it("is never filed after a Don't file, and its repeats only count", async () => {
    const lab = await openLab();
    await lab.breaks("disk is full");
    await lab.answer((await lab.asks())[0]!, { decision: "dont-file" });
    await lab.breaks("disk is full");
    const [row] = await lab.rows();
    expect(row).toMatchObject({ status: "dismissed", count: 2 });
    expect(lab.prompts.map((p) => p.kind)).toEqual(["draft"]);
    expect(await lab.asks()).toEqual([]);
  });

  it("caps new reports per window; the rest go on one storm report", async () => {
    const lab = await openLab({ limits: { newPerWindow: 2 } });
    for (const what of ["alpha broke", "beta broke", "gamma broke", "delta broke"]) await lab.breaks(what);
    const rows = await lab.rows();
    expect(rows.filter((r) => r.kind === "report")).toHaveLength(2);
    const storms = rows.filter((r) => r.kind === "storm");
    expect(storms).toHaveLength(1);
    expect(storms[0]!.storm!.entries.map((e) => e.message).sort()).toEqual(["delta broke", "gamma broke"]);
    // Three previews: two reports and the storm, never four.
    expect(await lab.asks()).toHaveLength(3);
  });

  it("files without a preview only for an error kind the Lab names", async () => {
    const lab = await openLab({ preview: { autoFile: ["request"] } });
    await lab.breaks("quota exceeded");
    expect(lab.prompts.map((p) => p.kind)).toEqual(["draft", "file"]);
    expect(await lab.asks()).toEqual([]);
  });

  it("takes every secret out of what the harness is shown and what the row keeps", async () => {
    const lab = await openLab();
    await lab.breaks(`upstream refused key ${SECRET}`);
    const [row] = await lab.rows();
    expect(lab.prompts[0]!.prompt).not.toContain(SECRET);
    expect(JSON.stringify(row!.draft)).not.toContain(SECRET);
  });

  it("adds a counted comment on a repeat after filing, and starts over once the issue is closed", async () => {
    const lab = await openLab({ preview: { autoFile: ["request"] }, limits: { commentEveryMs: 0 }, closed: true });
    await lab.breaks("cache miss storm");
    await lab.breaks("cache miss storm");
    expect(lab.prompts.map((p) => p.kind)).toEqual(["draft", "file", "comment"]);
    expect((await lab.rows())[0]).toMatchObject({ status: "closed" });
    await lab.breaks("cache miss storm");
    const [again] = await lab.rows();
    expect(again).toMatchObject({ status: "filed", count: 1, previousIssue: { identifier: "FIX-9" } });
  });
});

describe("a task that ended errored", () => {
  /** A failed request in a task's session, as the engine's final event reports it. */
  const failedIn = (lab: Lab, sessionId: string, requestId: string) => {
    lab.reporter.capture({ final: true, error: { message: "eng.tasker could not do it" }, requestId, flowKind: "tasker", actionName: "work", sessionId, userId: "alice" });
    return lab.reporter.idle();
  };

  it("is one report, and the task's failed requests join it rather than making their own", async () => {
    const lab = await openLab();
    const conv = await lab.host.conversation("alice");
    const added = await lab.host.act("alice", conv, "dispatchTask_tasks", { goal: "doomed [fail]", assignee: "eng.tasker" });
    expect(added.error, messageOf(added.error)).toBeUndefined();
    await lab.host.settled();
    await lab.reporter.idle();
    await lab.host.settled();
    const [task] = (await lab.host.rows("alice")).filter((row) => row.status === "errored");
    // The ledger row's owed mark is cleared once the reporter took it.
    expect(owedReports(task!)).toEqual([]);
    const rows = await lab.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "task", status: "previewing", task: { assignee: "eng.tasker" } });
    expect(rows[0]!.occurrences[0]).toMatchObject({ taskId: task!.id, requestId: task!.run!.requestId });

    // A failed request of that task, arriving after its ending, joins its report.
    await failedIn(lab, task!.run!.sessionId, "req_late");
    const after = await lab.rows();
    expect(after).toHaveLength(1);
    expect(after[0]!.heldRequests?.map((r) => r.requestId)).toEqual(["req_late"]);
  });

  it("reports nothing for a failed request whose task has not ended errored", async () => {
    const lab = await openLab();
    const conv = await lab.host.conversation("alice");
    await lab.host.act("alice", conv, "dispatchTask_tasks", { goal: "fine work", assignee: "eng.tasker" });
    await lab.host.settled();
    const [task] = await lab.host.rows("alice");
    await failedIn(lab, task!.run!.sessionId, "req_retried");
    expect(await lab.rows()).toEqual([]);
    expect(await lab.asks()).toEqual([]);
  });
});

describe("the reporter itself", () => {
  it("never reports its own failure", async () => {
    const lab = await openLab();
    lab.reporter.capture({ final: true, error: { message: "boom" }, requestId: "r1", flowKind: ERROR_REPORTER_FLOW, actionName: "report", userId: OPERATOR });
    await lab.reporter.idle();
    expect(await lab.rows()).toEqual([]);
  });

  it("takes no event that is not final", async () => {
    const lab = await openLab();
    lab.reporter.capture({ error: { message: "a step failed on the way" }, requestId: "r2", flowKind: "breaker", actionName: "run", userId: "alice" });
    await lab.reporter.idle();
    expect(await lab.rows()).toEqual([]);
  });

  it("runs a report only for the operator", async () => {
    const lab = await openLab();
    await lab.breaks("only the operator drafts");
    // A report session another user made for herself, before the operator's run made it.
    const sessionId = `${REPORT_SESSION_PREFIX}fp-not-yet`;
    await lab.open(ERROR_REPORTER_FLOW, sessionId, "mallory", { workerId: "error-reporter" });
    const intruder = await lab.host.act("mallory", sessionId, "report", {}, ERROR_REPORTER_FLOW);
    expect(messageOf(intruder.error)).toContain("Only the Lab's operator");
  });
});

describe("a person reporting a problem", () => {
  it("takes the same intake, preview and filing: one report in Inbox, nothing filed before the answer", async () => {
    const agentAnswer = mockGenerator({
      script: [
        {
          toolCalls: [
            { toolCallId: "r1", toolName: "reportProblem", args: { description: "The board shows a task as done that never ran", sessionId: "breaker-alice" } }
          ]
        },
        { text: "Reported; the operator will see it." }
      ]
    });
    const lab = await openLab({ agentAnswer });
    const turn = await lab.host.act(OPERATOR, CONVERSATION, "run", { message: "the board says done but nothing ran" }, ERROR_REPORTER_FLOW);
    expect(turn.error, messageOf(turn.error)).toBeUndefined();
    await lab.reporter.idle();
    const rows = await lab.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "manual", status: "previewing", description: "The board shows a task as done that never ran" });
    expect(await lab.asks()).toHaveLength(1);
    expect(lab.prompts.map((p) => p.kind)).toEqual(["draft"]);
  });
});

describe("the ledger's owed report", () => {
  const row = { id: "t1", attempts: 2, metadata: {} } as never;

  it("is marked on an errored ending only", () => {
    expect(owedReports(markReportOwed(row, { kind: "errored", error: "x" }))).toEqual([{ key: "reportOwed:2", marker: { attempt: 2, error: "x" } }]);
    expect(owedReports(markReportOwed(row, { kind: "completed", output: 1 }))).toEqual([]);
    expect(owedReports(markReportOwed(row, { kind: "retried", error: "x" }))).toEqual([]);
  });

  it("is sent where the reporter's intake is", () => {
    expect([REPORTER_FLOW, REPORTER_INTAKE_ENTRY, REPORTER_INTAKE_KEY]).toEqual([ERROR_REPORTER_INTAKE_FLOW, "intake", "error-report-intake"]);
  });

  it("can't be forged or cleared by a caller's metadata", () => {
    expect(callerMetadata({ "reportOwed:1": { attempt: 1, error: "x" }, keep: 1 })).toEqual({ keep: 1 });
  });

  it("is dropped in a Lab with no reporter", async () => {
    const host = bootBoardHost();
    open = host;
    const conv = await host.conversation("alice");
    await host.act("alice", conv, "dispatchTask_tasks", { goal: "doomed [fail]", assignee: "eng.tasker" });
    await host.settled();
    const ledger = await host.rows("alice");
    expect(ledger.some((r) => r.status === "errored")).toBe(true);
    expect(ledger.every((r) => owedReports(r).length === 0)).toBe(true);
  });
});
