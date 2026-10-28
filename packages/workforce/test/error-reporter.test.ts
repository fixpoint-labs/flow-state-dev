/** The Error Reporter on the real engine (FIX-1983). */
import { afterEach, describe, expect, it, vi } from "vitest";

// The send's own dispatch of a worker message (`from: "sendMessage"`) can be
// made to throw, so only the sending session's pass can land it (FIX-2271).
const fault = vi.hoisted(() => ({ throwFastPath: false }));
vi.mock("@flow-state-dev/core/types", async (original) => {
  const actual = await original<typeof import("@flow-state-dev/core/types")>();
  return {
    ...actual,
    dispatchThroughSeam: (ctx: never, spec: { action: string; from?: string }) =>
      spec.action === "onMessageReceived" && spec.from === "sendMessage" && fault.throwFastPath
        ? Promise.reject(new Error("the connection dropped"))
        : actual.dispatchThroughSeam(ctx, spec as never)
  };
});
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import { ensureSessionRecord, runAction } from "@flow-state-dev/engine";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { callerMetadata } from "../src/conversation-board/ledger";
import { owedReports } from "../src/conversation-board/report-owed";
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
import { boardWorkers, bootBoardHost, messageOf, ORG, type BoardHost, hearsMessages } from "./conversation-board-harness";
import { WORKER_MESSAGES_PATTERN, workerMessagesResources } from "../src/messages/message-log";

const OPERATOR = "olive";
const CONVERSATION = "s_error-reporter";
const SECRET = "sk-live-abcdefghijklmnop1234";

/** Every prompt the stand-in harness was handed, in order, and whether that harness held tracker tools. */
type Prompted = { kind: "draft" | "file" | "comment"; prompt: string; trackerTools: boolean };

/** How the stand-in answers beyond a clean run: a filing that fails `fileFails` times, a comment with no result. */
type StandIn = { closed?: boolean; trailer?: boolean; fileFails?: number; commentUnreadable?: boolean; draftThrows?: number };

/**
 * A harness that answers like one: a JSON draft, a filed issue, or a comment
 * verdict, by what its prompt asks for. Records what it was asked.
 */
function standInHarness(prompts: Prompted[], options: StandIn = {}) {
  let fileFails = options.fileFails ?? 0;
  let draftThrows = options.draftThrows ?? 0;
  return (feeds: { mcpTools?: unknown }) =>
    handler({
      name: "stand-in-harness",
      inputSchema: z.object({ prompt: z.string() }),
      execute: async (input, ctx) => {
        const kind = input.prompt.includes("draft ONE bug report") ? "draft" : input.prompt.includes("File this bug report") ? "file" : "comment";
        prompts.push({ kind, prompt: input.prompt, trackerTools: feeds.mcpTools !== undefined });
        if (kind === "draft" && draftThrows > 0) {
          draftThrows -= 1;
          throw new Error("the harness could not start");
        }
        const failsNow = kind === "file" && fileFails > 0 ? (fileFails -= 1, true) : false;
        const unreadable = failsNow || (kind === "comment" && options.commentUnreadable === true);
        const json =
          kind === "draft"
            ? { title: "Coordinator fails on a project with no repository", summary: "It throws.", stepsToReproduce: ["Send it work"], expected: "It works", actual: "It throws", suspectedCause: "No repo check", questions: ["Which team?"] }
            : kind === "file"
              ? { url: "https://tracker.example/FIX-9", identifier: "FIX-9" }
              : { closed: options.closed === true };
        const fenced = "```json\n" + JSON.stringify(json) + "\n```";
        // A harness that says something after its draft, as a checkout's own instructions can make it.
        if (options.trailer === true && kind === "draft") ctx.emit.message(fenced);
        const said = unreadable
          ? "The tracker refused the call."
          : options.trailer === true && kind === "draft"
            ? "I made no file changes; nothing to add."
            : fenced;
        return {
          source: "stand-in",
          status: "completed",
          sessionId: null,
          url: null,
          dispatchedAt: Date.now(),
          outcome: "finished",
          finalMessage: said,
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
    resources: { ...installation.resources, ...workerMessagesResources },
    internal: { actions: hearsMessages(installation, "breaker") },
    actions: { respond: { inputSchema: z.object({ message: z.string() }), block: door, userMessage: (i: { message: string }) => i.message } }
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
  /** Hand the intake one occurrence, as a board or the reporter's capture does. */
  intake: (occurrence: Record<string, unknown>) => Promise<unknown>;
  /** Start a report's run again, as a restart does. */
  rerun: (reportId: string) => Promise<void>;
};

let open: BoardHost | undefined;
afterEach(async () => {
  fault.throwFastPath = false;
  await open?.dispose();
  open = undefined;
});

/** Tracker tools as a Lab's project MCP servers hand them: none here, only whether a harness was given them. */
const trackerTools = Object.assign(async () => ({}), { named: async () => [] }) as never;

/** A Lab with the reporter on it, bound to the engine the way a Lab binds it. */
async function openLab(
  options: Partial<ErrorReporterOptions> & StandIn & { agentAnswer?: ReturnType<typeof mockGenerator>; hostRun?: (run: ErrorReporterHost["run"]) => ErrorReporterHost["run"] } = {}
): Promise<Lab> {
  const prompts: Prompted[] = [];
  const { agentAnswer, closed, trailer, fileFails, commentUnreadable, draftThrows, hostRun, ...reporterOptions } = options;
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
      [ERROR_REPORTER_FLOW]: defineErrorReporterFlow({ reporter, installation, harness: standInHarness(prompts, { closed, trailer, fileFails, commentUnreadable, draftThrows }), mcpTools: trackerTools })
    }),
    plainFlows: { [ERROR_REPORTER_INTAKE_FLOW]: (defineErrorReporterIntakeFlow({ reporter }) as any)({ id: ERROR_REPORTER_INTAKE_FLOW }) },
    generators: { "error-reporter-answer": agentAnswer ?? mockGenerator({ script: [] }) },
    errorCapture: (event) => reporter.capture(event)
  });
  open = host;
  const runtime = await host.state.getRuntime();
  const flowOf = (flowKind: string) => host.instances[flowKind] as FlowInstance;
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
  if (hostRun !== undefined) bound.run = hostRun(bound.run.bind(bound));
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
    const result = await host.act(userId, sessionId, "respond", { message: `throw:${message}` }, "breaker");
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
    open: (flowKind, sessionId, userId, state) => ensure(flowKind, sessionId, userId, ORG, state),
    intake: async (occurrence) => {
      const result = await bound.run({ flowKind: ERROR_REPORTER_INTAKE_FLOW, action: "intake", input: { occurrence }, userId: OPERATOR, orgId: ORG, sessionId: "error-report-intake", source: "internal" });
      expect(result.error, result.error).toBeUndefined();
      await host.settled();
      await reporter.idle();
      return result.output;
    },
    rerun: async (reportId) => {
      const result = await bound.run({ flowKind: ERROR_REPORTER_FLOW, action: "report", input: {}, userId: OPERATOR, orgId: ORG, sessionId: `${REPORT_SESSION_PREFIX}${reportId}`, source: "http" });
      expect(result.error, result.error).toBeUndefined();
      await host.settled();
      await reporter.idle();
    }
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
    expect(asks[0]!.reason).toBe("user_input");
    expect(asks[0]!.title).toBe("Error report: Coordinator fails on a project with no repository");
    expect(asks[0]!.message).toBe("Seen 1 time. File it?\n\n**Questions**\n\n- Which team?");

    await lab.answer(asks[0]!, { decision: "file", instructions: "Put it in the Platform team" });
    expect(lab.prompts.map((p) => p.kind)).toEqual(["draft", "file"]);
    // The operator's answer is folded into what files.
    expect(lab.prompts[1]!.prompt).toContain("Put it in the Platform team");
    const [filed] = await lab.rows();
    expect(filed).toMatchObject({ status: "filed", issue: { identifier: "FIX-9" } });
    expect(await lab.conversationLines()).toContainEqual(expect.stringContaining("Filed FIX-9"));
  });

  it("keeps the harness's draft when the harness says something after it", async () => {
    const lab = await openLab({ trailer: true });
    await lab.breaks("disk is full");
    const [row] = await lab.rows();
    expect(row?.draft?.title).toBe("Coordinator fails on a project with no repository");
    expect(row?.draft?.body).not.toContain("I made no file changes");
  });

  it("names the failing session's project, not the tracker's", async () => {
    const lab = await openLab();
    await lab.breaks("disk is full");
    const [row] = await lab.rows();
    expect(row?.draft?.body).not.toContain("shared/storefront");
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

/** A failed request as the capture hands it to the intake. */
const requestOccurrence = (requestId: string, message: string, at = Date.now()) => ({
  kind: "request",
  at,
  requestId,
  userId: "alice",
  sessionId: "breaker-alice",
  flowKind: "breaker",
  actionName: "run",
  message
});

describe("what the intake keeps", () => {
  it("counts a redelivered occurrence once", async () => {
    const lab = await openLab();
    await lab.intake(requestOccurrence("req_same", "the queue is full"));
    await lab.intake(requestOccurrence("req_same", "the queue is full"));
    await lab.intake(requestOccurrence("req_other", "the queue is full"));
    const [row] = await lab.rows();
    expect(row).toMatchObject({ count: 2 });
  });

  it("writes no secret into a row, a held request or a storm entry", async () => {
    const lab = await openLab({ limits: { newPerWindow: 1 } });
    await lab.intake(requestOccurrence("req_1", `first refused with ${SECRET}`));
    await lab.intake(requestOccurrence("req_2", `second refused with ${SECRET}`));
    await lab.intake({ ...requestOccurrence("req_3", `held refused with ${SECRET}`), kind: "held", taskId: "task_1" });
    const runtime = await lab.host.state.getRuntime();
    // Everything the Lab's org scope holds: report rows, the storm, and the held request.
    const stored = JSON.stringify(await runtime.stores.resourceState.getByPrefix("org", ORG, ""));
    expect(stored).toContain("held refused with");
    expect(stored).toContain("[redacted]");
    expect(stored).not.toContain(SECRET);
  });

  it("takes the operator's stored MCP key out of what it keeps", async () => {
    const lab = await openLab();
    const runtime = await lab.host.state.getRuntime();
    const key = "operatorlinearkey0123456789";
    await runtime.stores.resourceState.set("user", `${OPERATOR}:~org:${ORG}`, "mcp-credentials/linear", { value: key, setAt: "2026-10-13T00:00:00.000Z" }, "any");
    await lab.intake(requestOccurrence("req_key", `refused with ${key}`));
    const stored = JSON.stringify(await runtime.stores.resourceState.getByPrefix("org", ORG, ""));
    expect(stored).toContain("refused with [redacted]");
    expect(stored).not.toContain(key);
  });

  it("reads a named session against the user who named it, not the last user to report the same problem", async () => {
    const lab = await openLab();
    await lab.open("breaker", "breaker-alice", "alice", { workerId: "eng.breaker" });
    const manual = (userId: string, sessionId: string, named?: { sessionId: string }) => ({
      kind: "manual",
      at: Date.now(),
      description: "The board shows a task as done that never ran",
      userId,
      orgId: ORG,
      sessionId,
      ...(named === undefined ? {} : { named })
    });
    await lab.intake(manual("alice", "conv-alice", { sessionId: "breaker-alice" }));
    await lab.intake(manual("bob", "conv-bob"));
    const [row] = await lab.rows();
    expect(row).toMatchObject({ count: 2, named: { sessionId: "breaker-alice", by: "alice" } });
    const dossier = (await lab.reporter.dossierOf(row)) as { named?: { session?: unknown } };
    expect(dossier.named?.session).toMatchObject({ id: "breaker-alice", userId: "alice" });
  });

  it("leaves out a rescued failure the Lab's filter leaves out, as it does a captured one", async () => {
    const lab = await openLab({ filter: (event) => event.flowKind !== "coordinator" });
    // As a coordinator's rescue sends it: straight to the intake, past the capture.
    await lab.intake({ ...requestOccurrence("req_rescued", "the judgment turn crashed"), flowKind: "coordinator", blockName: "coordinator-judgment" });
    await lab.intake(requestOccurrence("req_kept", "the breaker broke"));
    expect((await lab.rows()).map((r) => r.parts.message)).toEqual(["the breaker broke"]);
  });

  it("never moves the cap's window back for a late occurrence", async () => {
    const lab = await openLab({ limits: { newPerWindow: 2 } });
    const hourAgo = Date.now() - 61 * 60_000;
    await lab.intake(requestOccurrence("req_a", "alpha broke"));
    await lab.intake(requestOccurrence("req_b", "beta broke"));
    // An old task's ending, delivered late, from the window before.
    await lab.intake(requestOccurrence("req_old", "old broke", hourAgo));
    await lab.intake(requestOccurrence("req_c", "gamma broke"));
    const reports = (await lab.rows()).filter((r) => r.kind === "report");
    expect(reports.map((r) => r.parts.message).sort()).toEqual(["alpha broke", "beta broke"]);
  });

  it("tries an intake again when the intake run fails, rather than dropping the failure", async () => {
    let failures = 1;
    const lab = await openLab({
      hostRun: (run) => async (r) => {
        if (r.action === "intake" && failures > 0) {
          failures -= 1;
          return { error: "the store was down" };
        }
        return run(r);
      }
    });
    lab.reporter.capture({ final: true, error: { message: "flaky store" }, requestId: "req_retry", flowKind: "breaker", actionName: "run", userId: "alice" });
    await lab.reporter.idle();
    for (let i = 0; i < 30 && (await lab.rows()).length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    await lab.reporter.idle();
    expect((await lab.rows()).map((r) => r.parts.message)).toEqual(["flaky store"]);
  });
});

describe("drafting, filing and commenting", () => {
  it("drafts with no tracker tools; only the approved filing gets them", async () => {
    const lab = await openLab();
    await lab.breaks("drafts read, filings write");
    await lab.answer((await lab.asks())[0]!, { decision: "file" });
    expect(lab.prompts.map((p) => [p.kind, p.trackerTools])).toEqual([
      ["draft", false],
      ["file", true]
    ]);
  });

  it("keeps an approved report owed when filing fails, and files it on the next run", async () => {
    const lab = await openLab({ fileFails: 1 });
    await lab.breaks("the tracker was down");
    await lab.answer((await lab.asks())[0]!, { decision: "file", instructions: "Label it P2" });
    const [failed] = await lab.rows();
    expect(failed).toMatchObject({ status: "filing", approved: { instructions: "Label it P2" } });
    expect(failed!.lastRunError).toContain("not filed");

    await lab.rerun(failed!.id);
    const [filed] = await lab.rows();
    expect(filed).toMatchObject({ status: "filed", issue: { identifier: "FIX-9" } });
    // Filed from the kept answer, with no second draft or preview.
    expect(lab.prompts.map((p) => p.kind)).toEqual(["draft", "file", "file"]);
    expect(lab.prompts[2]!.prompt).toContain("Label it P2");
  });

  it("runs a report once while another run holds it", async () => {
    const lab = await openLab({ fileFails: 1 });
    await lab.breaks("one run at a time");
    await lab.answer((await lab.asks())[0]!, { decision: "file" });
    const [row] = await lab.rows();
    // Two starts at once, as two processes would make: one files, the other finds it claimed.
    await Promise.all([lab.rerun(row!.id), lab.rerun(row!.id)]);
    expect(lab.prompts.filter((p) => p.kind === "file")).toHaveLength(2);
  });

  it("lets go of a report whose run failed, so the next start drafts it at once", async () => {
    const lab = await openLab({ draftThrows: 1 });
    await lab.breaks("harness down");
    const [row] = await lab.rows();
    expect(row).toMatchObject({ status: "drafting" });
    expect(row!.claim).toBeUndefined();
    await lab.rerun(row!.id);
    expect(lab.prompts.filter((p) => p.kind === "draft")).toHaveLength(2);
    expect(await lab.asks()).toHaveLength(1);
  });

  it("keeps a counted comment owed when the tracker gives no result", async () => {
    const lab = await openLab({ preview: { autoFile: ["request"] }, limits: { commentEveryMs: 0 }, commentUnreadable: true });
    await lab.breaks("comment me");
    await lab.breaks("comment me");
    const [row] = await lab.rows();
    expect(row).toMatchObject({ status: "filed", commentOwed: true });
    expect(row!.lastRunError).toContain("not commented");
    expect(await lab.conversationLines()).not.toContainEqual(expect.stringContaining("Commented on"));
  });

  it("files a storm with every failure listed by then, and owes a comment for later ones", async () => {
    const lab = await openLab({ limits: { newPerWindow: 1, commentEveryMs: 0 } });
    await lab.breaks("first broke");
    await lab.breaks("second broke");
    const storm = (await lab.asks()).find((a) => JSON.stringify(a).includes("storm"))!;
    // Listed after the storm's draft was shown.
    await lab.breaks("third broke");
    await lab.answer(storm, { decision: "file" });
    const filing = lab.prompts.filter((p) => p.kind === "file").at(-1)!;
    expect(filing.prompt).toContain("third broke");

    await lab.breaks("fourth broke");
    const [filedStorm] = (await lab.rows()).filter((r) => r.kind === "storm");
    expect(filedStorm!.storm!.entries.map((e) => e.message)).toContain("fourth broke");
    expect(lab.prompts.at(-1)!.kind).toBe("comment");
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
    const added = await lab.host.act("alice", conv, "createTask_tasks", { goal: "doomed [fail]", assignee: "eng.tasker" });
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
    await lab.host.act("alice", conv, "createTask_tasks", { goal: "fine work", assignee: "eng.tasker" });
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

describe("a report's session", () => {
  // The Error Reporter flow declares the work-project action (FIX-2161), and a report's
  // session carries only its worker, so only its id marks it as the reporter's own.
  it("can't be set to work in a project, while the operator's own conversation with the reporter gets to the project check", async () => {
    const lab = await openLab();
    const project = { project: { visibility: "shared", id: "storefront" } };
    const report = `${REPORT_SESSION_PREFIX}fp-a-report`;
    await lab.open(ERROR_REPORTER_FLOW, report, OPERATOR, { workerId: "error-reporter" });
    const refused = await lab.host.act(OPERATOR, report, "setWorkProject", project, ERROR_REPORTER_FLOW);
    expect(messageOf(refused.error)).toContain("an error report's session");
    const own = "operator-talks-to-the-reporter";
    await lab.open(ERROR_REPORTER_FLOW, own, OPERATOR, { workerId: "error-reporter" });
    const checked = await lab.host.act(OPERATOR, own, "setWorkProject", project, ERROR_REPORTER_FLOW);
    expect(messageOf(checked.error)).toContain('no project "storefront"');
  });
});

describe("a user reporting a problem", () => {
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
    const turn = await lab.host.act(OPERATOR, CONVERSATION, "respond", { message: "the board says done but nothing ran" }, ERROR_REPORTER_FLOW);
    expect(turn.error, messageOf(turn.error)).toBeUndefined();
    await lab.reporter.idle();
    const rows = await lab.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "manual", status: "previewing", description: "The board shows a task as done that never ran" });
    expect(await lab.asks()).toHaveLength(1);
    expect(lab.prompts.map((p) => p.kind)).toEqual(["draft"]);
  });
});

describe("a message the reporter sends", () => {
  // The reporter offers sendMessage like any agent worker. Its session's board
  // pass is what sends a message again whose own dispatch failed; without the
  // pass the message is lost and nobody is told (FIX-2271).
  it("is sent again by the reporter's pass when its own dispatch throws, and lands once", async () => {
    fault.throwFastPath = true;
    const agentAnswer = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "m1", toolName: "sendMessage", args: { to: "lead", text: "Is the board down for you too?" } }] },
        { text: "Asked the lead." }
      ]
    });
    const lab = await openLab({ agentAnswer });
    const turn = await lab.host.act(OPERATOR, CONVERSATION, "respond", { message: "ask the lead whether the board is down" }, ERROR_REPORTER_FLOW);
    expect(turn.error, messageOf(turn.error)).toBeUndefined();
    const runtime = await lab.host.state.getRuntime();
    const rows = async () =>
      Object.values(await runtime.stores.resourceState.getByPrefix("user", `${OPERATOR}:~org:${ORG}`, WORKER_MESSAGES_PATTERN.replace("*", ""))).map(
        (value) => value.state as Record<string, any>
      );
    const [sent] = await rows();
    expect(sent).toMatchObject({ status: "unconfirmed", reason: "the connection dropped" });
    let row = sent;
    for (let i = 0; i < 150 && row?.status !== "delivered"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      [row] = await rows();
    }
    expect(row).toMatchObject({ status: "delivered", resent: { n: 1 } });
  }, 30_000);
});

describe("the ledger's owed report", () => {
  const row = { id: "t1", attempts: 2, metadata: {} } as never;

  it("is read off a row stored before FIX-2078 only: nothing writes one now", () => {
    expect(owedReports(row)).toEqual([]);
    const stored = { id: "t1", attempts: 2, metadata: { "reportOwed:2": { attempt: 2, error: "x" } } } as never;
    expect(owedReports(stored)).toEqual([{ key: "reportOwed:2", marker: { attempt: 2, error: "x" } }]);
  });

  it("stored before FIX-2078 is sent on the board's next touch and dropped once no reporter will take it", async () => {
    const host = bootBoardHost();
    open = host;
    const conv = await host.conversation("alice");
    await host.act("alice", conv, "createTask_tasks", { goal: "doomed [fail]", assignee: "eng.tasker" });
    await host.settled();
    const filing = await host.filingOf("alice", conv);
    const [failed] = (await host.rows("alice")).filter((r) => r.status === "errored");
    const { partition: _p, ...stored } = failed!;
    await host.writeRow("alice", filing, { ...(stored as never), metadata: { ...(stored.metadata ?? {}), "reportOwed:1": { attempt: 1, error: "x" } } } as never);
    await host.act("alice", conv, "listTasks_tasks", {});
    await host.settled();
    const after = (await host.rows("alice")).find((r) => r.id === failed!.id)!;
    expect(owedReports(after)).toEqual([]);
  });

  it("can't be forged or cleared by a caller's metadata", () => {
    expect(callerMetadata({ "reportOwed:1": { attempt: 1, error: "x" }, keep: 1 })).toEqual({ keep: 1 });
  });

  it("is dropped in a Lab with no reporter", async () => {
    const host = bootBoardHost();
    open = host;
    const conv = await host.conversation("alice");
    await host.act("alice", conv, "createTask_tasks", { goal: "doomed [fail]", assignee: "eng.tasker" });
    await host.settled();
    const ledger = await host.rows("alice");
    expect(ledger.some((r) => r.status === "errored")).toBe(true);
    expect(ledger.every((r) => owedReports(r).length === 0)).toBe(true);
  });
});
