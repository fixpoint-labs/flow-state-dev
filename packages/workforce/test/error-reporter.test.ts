/** The Error Reporter on the real engine (FIX-1983). */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// The send's own dispatch of a worker message (`from: "sendMessage"`) can be
// made to throw, so only the sending session's pass can land it (FIX-2271).
const fault = vi.hoisted(() => ({ throwFastPath: false }));
vi.mock("@flow-state-dev/core/internal", async (original) => {
  const actual = await original<typeof import("@flow-state-dev/core/internal")>();
  return {
    ...actual,
    dispatchThroughSeam: (ctx: never, spec: { action: string; from?: string }) =>
      spec.action === "onMessageReceived" && spec.from === "sendMessage" && fault.throwFastPath
        ? Promise.reject(new Error("the connection dropped"))
        : actual.dispatchThroughSeam(ctx, spec as never)
  };
});
import { defineFlow, handler, readResourceContentTool, resourceSearchTools } from "@flow-state-dev/core";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import { ensureSessionRecord } from "@flow-state-dev/engine/host";
import { runAction } from "@flow-state-dev/engine";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { callerMetadata } from "../src/conversation-board/ledger";
import { owedReports } from "../src/conversation-board/report-owed";
import {
  createErrorReporter,
  defineErrorHistoryCollection,
  defineErrorReporterFlow,
  defineErrorReporterIntakeFlow,
  ERROR_REPORTER_FLOW,
  ERROR_REPORTER_INTAKE_FLOW,
  REPORT_SESSION_PREFIX,
  type ErrorReporter,
  type ErrorReporterHost,
  type ErrorReporterOptions,
  type ReportResourceState
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
type StandIn = {
  closed?: boolean;
  trailer?: boolean;
  fileFails?: number;
  commentUnreadable?: boolean;
  draftThrows?: number;
  draftTitle?: string;
  /** Each run's draft title and filed issue, in turn, for reports that must differ: past the list, the defaults. */
  turns?: Array<{ title: string; identifier: string }>;
};

/**
 * A harness that answers like one: a JSON draft, a filed issue, or a comment
 * verdict, by what its prompt asks for. Records what it was asked.
 */
function standInHarness(prompts: Prompted[], options: StandIn = {}) {
  let fileFails = options.fileFails ?? 0;
  let draftThrows = options.draftThrows ?? 0;
  let drafts = 0;
  let files = 0;
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
        const turn = kind === "draft" ? options.turns?.[drafts++] : kind === "file" && !failsNow ? options.turns?.[files++] : undefined;
        const identifier = turn?.identifier ?? "FIX-9";
        const json =
          kind === "draft"
            ? { title: turn?.title ?? options.draftTitle ?? "Coordinator fails on a project with no repository", summary: "It throws.", stepsToReproduce: ["Send it work"], expected: "It works", actual: "It throws", suspectedCause: "No repo check", questions: ["Which team?"] }
            : kind === "file"
              ? { url: `https://tracker.example/${identifier}`, identifier }
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
    actions: { respond: { block: door, userMessage: (i: { message: string }) => i.message } }
  });
}

/** A flow whose actions are core's two general read tools, over the error history: what a worker's turn calls. */
const HISTORY_READER = "history-reader";
function historyReaderFlow(reporter: ErrorReporter) {
  const { searchResources } = resourceSearchTools();
  return defineFlow({
    kind: HISTORY_READER,
    resources: { errorHistory: defineErrorHistoryCollection({ reporter }) },
    actions: {
      searchResources: { inputSchema: searchResources.inputSchema, block: searchResources },
      readResourceContent: { inputSchema: z.object({ uri: z.string().optional() }), block: readResourceContentTool() }
    }
  } as never);
}

type Lab = {
  host: BoardHost;
  reporter: ErrorReporter;
  prompts: Prompted[];
  rows: () => Promise<ReportResourceState[]>;
  asks: () => Promise<SuspensionRecord[]>;
  answer: (ask: SuspensionRecord, data: Record<string, unknown>) => Promise<void>;
  breaks: (message: string, userId?: string) => Promise<void>;
  conversationLines: () => Promise<string[]>;
  open: (flowKind: string, sessionId: string, userId: string, state: Record<string, unknown>) => Promise<unknown>;
  /** Hand the intake one occurrence, as a board or the reporter's capture does. */
  intake: (occurrence: Record<string, unknown>) => Promise<unknown>;
  /** Start a report's run again, as a restart does. */
  rerun: (reportId: string) => Promise<void>;
  /** Run the reporter's line entry in `sessionId` as `userId`, as the reporter's `say` does. */
  line: (userId: string, sessionId: string, input: { text: string; forOperator?: string }) => Promise<void>;
  /** Search the error history as `userId` would through `searchResources`: the uris and snippets. */
  searchHistory: (userId: string, input: { query: string; prefix?: string }, orgId?: string) => Promise<Array<{ uri: string; snippet: string }>>;
  /** Read one history record as `userId` would through `readResourceContent`: its content, or the tool's error. */
  readHistory: (userId: string, uri: string, orgId?: string) => Promise<{ content?: string; error?: string }>;
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
  const { agentAnswer, closed, trailer, fileFails, commentUnreadable, draftThrows, draftTitle, turns, hostRun, ...reporterOptions } = options;
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
      // Its file names the general read tools, as the devteam tree's does.
      { id: "error-reporter", declared: { flow: ERROR_REPORTER_FLOW, tools: ["searchResources", "readResourceContent"] }, body: "You report errors.", skills: [] }
    ],
    flows: (installation) => ({
      breaker: breakerFlow(installation),
      [ERROR_REPORTER_FLOW]: defineErrorReporterFlow({
        reporter,
        installation,
        harness: standInHarness(prompts, { closed, trailer, fileFails, commentUnreadable, draftThrows, draftTitle, turns }),
        mcpTools: trackerTools,
        agent: { catalog: { searchResources: resourceSearchTools().searchResources, readResourceContent: readResourceContentTool() } }
      })
    }),
    plainFlows: {
      [ERROR_REPORTER_INTAKE_FLOW]: (defineErrorReporterIntakeFlow({ reporter }) as any)({ id: ERROR_REPORTER_INTAKE_FLOW }),
      [HISTORY_READER]: (historyReaderFlow(reporter) as any)({ id: HISTORY_READER })
    },
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
    return ((result.output as { rows?: ReportResourceState[] }).rows ?? []).filter((row) => row.kind === "report" || row.kind === "storm");
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
    searchHistory: async (userId, input, orgId = ORG) => {
      const sessionId = `reader-${userId}-${orgId}`;
      await ensure(HISTORY_READER, sessionId, userId, orgId, {});
      const result = await host.act(userId, sessionId, "searchResources", { prefix: null, ...input }, HISTORY_READER, orgId);
      expect(result.error, messageOf(result.error)).toBeUndefined();
      return ((result.output as { results: Array<{ uri: string; snippet: string }> }).results ?? []).map(({ uri, snippet }) => ({ uri, snippet }));
    },
    readHistory: async (userId, uri, orgId = ORG) => {
      const sessionId = `reader-${userId}-${orgId}`;
      await ensure(HISTORY_READER, sessionId, userId, orgId, {});
      const result = await host.act(userId, sessionId, "readResourceContent", { uri }, HISTORY_READER, orgId);
      return result.error === undefined ? { content: String((result.output as { content?: unknown }).content) } : { error: messageOf(result.error) };
    },
    line: async (userId, sessionId, input) => {
      const result = await bound.run({ flowKind: ERROR_REPORTER_FLOW, action: "line", input, userId, orgId: ORG, sessionId, source: "internal" });
      expect(result.error, result.error).toBeUndefined();
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
    // Where it came from and how often, in its own words, so Inbox shows them with no error-report knowledge.
    expect(asks[0]!.message).toBe("From a failed request (breaker / respond) · seen 1 time. File it?\n\n**Questions**\n\n- Which team?");
    expect(asks[0]!.data).toMatchObject({ source: "request", count: 1 });

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

/** The history records the Lab's org holds (`error-reports/log-<day>-<hour>`), by key. */
async function historyOf(lab: Lab): Promise<Record<string, { entries: Array<Record<string, any>>; cut?: number }>> {
  const runtime = await lab.host.state.getRuntime();
  const stored = await runtime.stores.resourceState.getByPrefix("org", ORG, "error-reports/log-");
  return Object.fromEntries(Object.entries(stored).map(([key, value]) => [key, value.state as never]));
}

/** Every history entry the Lab's org holds, oldest hour first. */
async function entriesOf(lab: Lab): Promise<Array<Record<string, any>>> {
  const records = await historyOf(lab);
  return Object.keys(records)
    .sort()
    .flatMap((key) => records[key]!.entries);
}

/** The UTC hour key a time falls in. */
const hourKeyOf = (at: number) => `error-reports/log-${new Date(at).toISOString().slice(0, 13).replace("T", "-")}`;

describe("the history", () => {
  // The report keeps only its newest five occurrences; the history is where the first one's time and ids live on.
  it("keeps every occurrence of one failure in its hour's record, past the five the report keeps", async () => {
    const lab = await openLab();
    const at = Date.now();
    for (let i = 1; i <= 7; i += 1) await lab.intake(requestOccurrence(`req_${i}`, "the queue is full", at + i));
    const [row] = await lab.rows();
    expect(row!.occurrences.map((o) => o.requestId)).toEqual(["req_3", "req_4", "req_5", "req_6", "req_7"]);
    const records = await historyOf(lab);
    const entries = records[hourKeyOf(at)]?.entries ?? [];
    const occurrences = entries.filter((e) => e.kind === "occurrence");
    expect(occurrences.map((e) => e.requestId)).toEqual(["req_1", "req_2", "req_3", "req_4", "req_5", "req_6", "req_7"]);
    // Each with its time, its ids, the report it went to and a short message.
    expect(occurrences[0]).toMatchObject({ at: at + 1, reportId: row!.id, userId: "alice", sessionId: "breaker-alice", message: "the queue is full" });
  });

  // A held request names no report yet (its task may still pass), so its entry is joined to the task's report when read.
  it("keeps a held request by its task, naming no report", async () => {
    const lab = await openLab();
    await lab.intake({ ...requestOccurrence("req_held", "the step timed out"), kind: "held", taskId: "task_7" });
    expect(await lab.rows()).toEqual([]);
    const [entry, ...rest] = await entriesOf(lab);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ kind: "occurrence", source: "held", taskId: "task_7", requestId: "req_held" });
    expect(entry!.reportId).toBeUndefined();
  });

  it("logs a redelivered occurrence once", async () => {
    const lab = await openLab();
    await lab.intake(requestOccurrence("req_same", "the queue is full"));
    await lab.intake(requestOccurrence("req_same", "the queue is full"));
    expect((await entriesOf(lab)).filter((e) => e.kind === "occurrence").map((e) => e.requestId)).toEqual(["req_same"]);
  });

  // One hour's record has an upper size: a storm is counted, not kept, once the hour is full.
  it("counts an occurrence past the hour's cap instead of keeping it", async () => {
    const lab = await openLab();
    const at = Date.now();
    const key = hourKeyOf(at);
    const full = Array.from({ length: 250 }, (_, i) => ({ at: at - 1000 + i, kind: "occurrence", key: `request:old_${i}`, requestId: `old_${i}` }));
    const runtime = await lab.host.state.getRuntime();
    await runtime.stores.resourceState.set("org", ORG, key, { hour: key.slice("error-reports/log-".length), entries: full, cut: 0 }, "any");
    await lab.intake(requestOccurrence("req_late", "the queue is full", at));
    const record = (await historyOf(lab))[key]!;
    expect(record.entries).toHaveLength(250);
    expect(record.entries.some((e) => e.requestId === "req_late")).toBe(false);
    // The occurrence, and the status changes of the report it made, are each counted.
    expect(record.cut).toBeGreaterThanOrEqual(1);
  });

  // A redelivery is one occurrence whether its hour kept it or only counted it.
  it("counts a redelivered occurrence past the hour's cap once", async () => {
    const lab = await openLab();
    const at = Date.now();
    const key = hourKeyOf(at);
    const full = Array.from({ length: 250 }, (_, i) => ({ at: at - 1000 + i, kind: "occurrence", key: `request:old_${i}`, requestId: `old_${i}` }));
    const runtime = await lab.host.state.getRuntime();
    await runtime.stores.resourceState.set("org", ORG, key, { hour: key.slice("error-reports/log-".length), entries: full, cut: 0 }, "any");
    await lab.intake(requestOccurrence("req_late", "the queue is full", at));
    const once = (await historyOf(lab))[key]!.cut;
    await lab.intake(requestOccurrence("req_late", "the queue is full", at));
    expect((await historyOf(lab))[key]!.cut).toBe(once);
  });

  // A failure back after its issue closed is a new report under the same id: its own statuses are kept, not taken for the old one's.
  it("keeps a reopened report's statuses beside the closed one's in the same hour", async () => {
    const lab = await openLab({ preview: { autoFile: ["request"] }, limits: { commentEveryMs: 0 }, closed: true });
    await lab.breaks("cache miss storm");
    await lab.breaks("cache miss storm");
    await lab.breaks("cache miss storm");
    const [again] = await lab.rows();
    const statuses = (await entriesOf(lab)).filter((e) => e.kind === "status" && e.reportId === again!.id).map((e) => e.status);
    expect(statuses).toEqual(["drafting", "previewing", "filing", "filed", "closed", "drafting", "previewing", "filing", "filed"]);
  });

  // When a report was filed or dismissed is only known from the history: the report keeps its current status alone.
  it("keeps each change of a report's status with its time, and the issue once filed", async () => {
    const lab = await openLab();
    await lab.breaks("disk is full");
    await lab.answer((await lab.asks())[0]!, { decision: "file" });
    const [row] = await lab.rows();
    const statuses = (await entriesOf(lab)).filter((e) => e.kind === "status" && e.reportId === row!.id);
    expect(statuses.map((e) => e.status)).toEqual(["drafting", "previewing", "filing", "filed"]);
    expect(statuses.every((e) => typeof e.at === "number")).toBe(true);
    expect(statuses.at(-1)).toMatchObject({ issue: { identifier: "FIX-9", url: "https://tracker.example/FIX-9" } });
  });

  it("keeps a dismissal, and nothing for a write that moves no status", async () => {
    const lab = await openLab();
    await lab.breaks("disk is full");
    await lab.answer((await lab.asks())[0]!, { decision: "dont-file" });
    // A repeat while dismissed only counts: no status moves.
    await lab.breaks("disk is full");
    const statuses = (await entriesOf(lab)).filter((e) => e.kind === "status");
    expect(statuses.map((e) => e.status)).toEqual(["drafting", "previewing", "dismissed"]);
  });

  // A status change is logged by `updateReport` only. These are the writers that may write a report another
  // way, each because what it writes is a first status (`owed`, already logged as its occurrence) or no report.
  // A new writer here moves a status with no history entry unless it writes its own: add it on purpose.
  it("is written for status changes by updateReport alone: no other module writes a report", () => {
    const dir = fileURLToPath(new URL("../src/error-reporter/", import.meta.url));
    const writers: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(`${dir}${file}`, "utf8");
      for (const match of source.matchAll(/updateStateWith\(|\.upsert\(|\.patchState\(|\.setState\(/g)) {
        const before = source.slice(0, match.index);
        const fn = [...before.matchAll(/function (\w+)/g)].at(-1)?.[1] ?? "(module)";
        writers.push(`${file}:${fn}:${match[0]}`);
      }
    }
    expect(writers.sort()).toEqual(
      [
        "history.ts:appendHistory:updateStateWith(",
        "reports.ts:claimCapSlot:updateStateWith(",
        "reports.ts:countOn:updateStateWith(",
        "reports.ts:decide:updateStateWith(",
        "reports.ts:intakeOccurrence:.upsert(",
        "reports.ts:intakeOccurrence:updateStateWith(",
        "reports.ts:listOnStorm:updateStateWith(",
        "reports.ts:updateReport:updateStateWith("
      ].sort()
    );
  });

  // Retention is by computed key: the first record of a day deletes days 91 to 97 back, never listing the collection.
  it("deletes the records past 90 days when a day's first record is written, and keeps day 90", async () => {
    const lab = await openLab();
    const runtime = await lab.host.state.getRuntime();
    const now = Date.now();
    const daysBack = (n: number) => new Date(now - n * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const seeded = [90, 91, 97].map((n) => `error-reports/log-${daysBack(n)}-05`);
    for (const key of seeded) await runtime.stores.resourceState.set("org", ORG, key, { hour: key.slice(18), entries: [], cut: 0 }, "any");
    await lab.intake(requestOccurrence("req_today", "the queue is full", now));
    const kept = Object.keys(await historyOf(lab));
    expect(kept).toContain(seeded[0]);
    expect(kept).not.toContain(seeded[1]);
    expect(kept).not.toContain(seeded[2]);
  });
});

describe("reading the history", () => {
  const today = () => new Date().toISOString().slice(0, 10);
  /** The report hash a record's path ends with: the same for every reader, whatever words its slug takes. */
  const hashOf = (uri: string) => uri.slice(uri.lastIndexOf("-") + 1);
  const TITLE = "Coordinator fails on a project with no repository";

  it("is found with searchResources and read with readResourceContent: title, status in words, ids, never the fingerprint", async () => {
    const lab = await openLab();
    await lab.breaks("disk is full");
    const [row] = await lab.rows();
    const hits = await lab.searchHistory(OPERATOR, { query: "error report", prefix: `error-history/${today()}` });
    expect(hits.map((h) => h.uri)).toEqual([expect.stringMatching(new RegExp(`^org/error-history/${today()}/[a-z0-9-]+$`))]);
    expect(hits[0]!.uri).not.toContain(row!.fingerprint.slice(0, 8));
    const read = await lab.readHistory(OPERATOR, hits[0]!.uri);
    expect(read.content).toContain(TITLE);
    expect(read.content).toContain("waiting in Inbox");
    expect(read.content).toContain(row!.occurrences[0]!.requestId!);
    expect(read.content).not.toContain(row!.fingerprint);
  });

  it("says a filed report is filed, with the issue's identifier and URL", async () => {
    const lab = await openLab();
    await lab.breaks("disk is full");
    await lab.answer((await lab.asks())[0]!, { decision: "file" });
    const [hit] = await lab.searchHistory(OPERATOR, { query: "filed" });
    const read = await lab.readHistory(OPERATOR, hit!.uri);
    expect(read.content).toContain("filed");
    expect(read.content).toContain("FIX-9");
    expect(read.content).toContain("https://tracker.example/FIX-9");
  });

  // Deny by default: a title can quote a user's own words, so another user's turn reads nothing of it.
  it("shows a user only their own failures, and anyone else what an unknown path shows", async () => {
    const lab = await openLab();
    await lab.intake({ kind: "task", at: Date.now(), taskId: "task_alice_1", boardId: "board_a", attempt: 1, error: "eng.tasker could not do it", userId: "alice", orgId: ORG, assignee: "eng.tasker" });
    const [hit] = await lab.searchHistory(OPERATOR, { query: "error report" });
    expect(hit).toBeDefined();
    // Alice reads her own, under a path with the same report hash, in her own words; the operator reads everything.
    const own = await lab.searchHistory("alice", { query: "error report" });
    expect(own.map((h) => hashOf(h.uri))).toEqual([hashOf(hit!.uri)]);
    expect((await lab.readHistory("alice", own[0]!.uri)).content).toContain("eng.tasker could not do it");
    expect((await lab.readHistory(OPERATOR, hit!.uri)).content).toContain(TITLE);
    // Bob, in the same org, finds nothing by her title's words or her task's id, and reads nothing of it.
    expect(await lab.searchHistory("bob", { query: TITLE })).toEqual([]);
    expect(await lab.searchHistory("bob", { query: "task_alice_1" })).toEqual([]);
    const refused = await lab.readHistory("bob", hit!.uri);
    const unknown = await lab.readHistory("bob", `org/error-history/${today()}/no-such-report-zz9`);
    expect(refused.content).toBeUndefined();
    expect(refused.error?.replace(hit!.uri, "<uri>")).toBe(unknown.error?.replace(`org/error-history/${today()}/no-such-report-zz9`, "<uri>"));
  });

  // A held request's entry names only its task; the read joins it to the report the task's ending went to.
  it("shows a held request under its task's report, joined when read", async () => {
    const lab = await openLab();
    await lab.intake({ ...requestOccurrence("req_held_1", "the step timed out"), kind: "held", taskId: "task_9" });
    await lab.intake({ kind: "task", at: Date.now(), taskId: "task_9", boardId: "board_a", attempt: 1, error: "eng.tasker gave up", userId: "alice", orgId: ORG, assignee: "eng.tasker" });
    const [hit] = await lab.searchHistory(OPERATOR, { query: "task_9" });
    expect((await lab.readHistory(OPERATOR, hit!.uri)).content).toContain("req_held_1");
  });

  // A failure back after its issue closed reuses the report's id. A day of the earlier report must still read as
  // that report: an operator checking what was filed before would otherwise see the new issue on the old days.
  it("shows a reopened report's earlier days with the earlier report's own title, count, status and issue", async () => {
    const turns = [
      { title: "Cache misses pile up under load", identifier: "FIX-9" },
      { title: "Cache misses are back after the fix", identifier: "FIX-12" }
    ];
    const lab = await openLab({ preview: { autoFile: ["request"] }, limits: { commentEveryMs: 0 }, closed: true, turns });
    await lab.breaks("cache miss storm");
    await lab.breaks("cache miss storm");
    await lab.breaks("cache miss storm");
    const hits = await lab.searchHistory(OPERATOR, { query: "error report", prefix: `error-history/${today()}` });
    expect(hits).toHaveLength(2);
    expect(new Set(hits.map((h) => hashOf(h.uri))).size).toBe(2);
    const contents = await Promise.all(hits.map(async (h) => (await lab.readHistory(OPERATOR, h.uri)).content!));
    const earlier = contents.find((c) => c.includes(`# ${turns[0]!.title}`))!;
    const later = contents.find((c) => c.includes(`# ${turns[1]!.title}`))!;
    expect(earlier).toBeDefined();
    expect(earlier).toContain("Error report, issue closed.");
    expect(earlier).toContain("Seen 2 time(s)");
    expect(earlier).toContain("Issue: FIX-9 https://tracker.example/FIX-9");
    expect(earlier).not.toContain("FIX-12");
    expect(later).toBeDefined();
    expect(later).toContain("Error report, filed.");
    expect(later).toContain("Seen 1 time(s)");
    expect(later).toContain("Issue: FIX-12 https://tracker.example/FIX-12");
    expect(later).not.toContain("FIX-9");
  });

  // History written before reports kept their earlier selves: the entries alone still tell the earlier report apart.
  it("still tells an earlier report's days apart when the report and its entries predate keeping them", async () => {
    const lab = await openLab({ preview: { autoFile: ["request"] }, limits: { commentEveryMs: 0 }, closed: true, turns: [{ title: "Cache misses pile up under load", identifier: "FIX-9" }, { title: "Cache misses are back after the fix", identifier: "FIX-12" }] });
    await lab.breaks("cache miss storm");
    await lab.breaks("cache miss storm");
    await lab.breaks("cache miss storm");
    const runtime = await lab.host.state.getRuntime();
    for (const [key, value] of Object.entries(await runtime.stores.resourceState.getByPrefix("org", ORG, "error-reports/"))) {
      const state = ((value as { state?: unknown }).state ?? value) as Record<string, unknown>;
      if (Array.isArray(state.entries)) {
        const entries = (state.entries as Array<Record<string, unknown>>).map(({ since: _since, ...e }) => e);
        await runtime.stores.resourceState.set("org", ORG, key, { ...state, entries }, "any");
      } else if (state.earlier !== undefined) {
        const { earlier: _earlier, ...report } = state;
        await runtime.stores.resourceState.set("org", ORG, key, report, "any");
      }
    }
    const hits = await lab.searchHistory(OPERATOR, { query: "error report", prefix: `error-history/${today()}` });
    expect(hits).toHaveLength(2);
    const contents = await Promise.all(hits.map(async (h) => (await lab.readHistory(OPERATOR, h.uri)).content!));
    const earlier = contents.find((c) => !c.includes("FIX-12"))!;
    expect(earlier).toBeDefined();
    expect(earlier).toContain("Error report, issue closed.");
    expect(earlier).toContain("Seen 2 time(s)");
    expect(earlier).toContain("Issue: FIX-9 https://tracker.example/FIX-9");
  });

  // A task's failed requests are held until it ends, so one can land on the day before its report started. Once that
  // report has been replaced, the request's day must still read as the report its task went to, not the new one.
  it("shows a held request from the day before as the earlier report its task went to", async () => {
    const turns = [
      { title: "Tasker gives up on large repositories", identifier: "FIX-9" },
      { title: "Tasker gives up again after the fix", identifier: "FIX-12" }
    ];
    const lab = await openLab({ preview: { autoFile: ["task"] }, limits: { commentEveryMs: 0 }, closed: true, turns });
    const now = Date.now();
    const yesterday = new Date(now - 24 * 60 * 60_000).toISOString().slice(0, 10);
    const ending = (taskId: string) => ({ kind: "task", at: Date.now(), taskId, boardId: "board_a", attempt: 1, error: "eng.tasker gave up", userId: "alice", orgId: ORG, assignee: "eng.tasker" });
    await lab.intake({ ...requestOccurrence("req_held_late", "the step timed out", now - 24 * 60 * 60_000), kind: "held", taskId: "task_a" });
    await lab.intake(ending("task_a"));
    await lab.intake(ending("task_b"));
    await lab.intake(ending("task_c"));
    expect((await lab.rows())[0]).toMatchObject({ status: "filed", issue: { identifier: "FIX-12" } });
    const [hit, ...more] = await lab.searchHistory(OPERATOR, { query: "error report", prefix: `error-history/${yesterday}` });
    expect(more).toEqual([]);
    const read = (await lab.readHistory(OPERATOR, hit!.uri)).content!;
    expect(read).toContain("req_held_late");
    expect(read).toContain(`# ${turns[0]!.title}`);
    expect(read).toContain("Issue: FIX-9 https://tracker.example/FIX-9");
    expect(read).not.toContain("FIX-12");
  });

  it("links the operator to a waiting report's Inbox item, and a user who failed the same way to nothing they can't open", async () => {
    const lab = await openLab({ inboxLink });
    await lab.breaks("disk is full");
    const [report] = await lab.rows();
    const [mine] = await lab.searchHistory(OPERATOR, { query: "error report" });
    const operator = (await lab.readHistory(OPERATOR, mine!.uri)).content!;
    expect(operator).toContain(`[Open it in Inbox](/inbox/${encodeURIComponent(`${REPORT_SESSION_PREFIX}${report!.id}`)})`);
    expect(readText(operator)).not.toMatch(FINGERPRINT);
    const [theirs] = await lab.searchHistory("alice", { query: "error report" });
    const alice = (await lab.readHistory("alice", theirs!.uri)).content!;
    expect(alice).toContain("waiting in Inbox");
    expect(alice).not.toContain("/inbox/");

    // Once filed, it waits nowhere: the record names the issue, and no Inbox link.
    await lab.answer((await lab.asks())[0]!, { decision: "file" });
    const filed = (await lab.readHistory(OPERATOR, mine!.uri)).content!;
    expect(filed).toContain("FIX-9 https://tracker.example/FIX-9");
    expect(filed).not.toContain("/inbox/");
  });

  it("writes nothing when read", async () => {
    const lab = await openLab();
    await lab.breaks("disk is full");
    const runtime = await lab.host.state.getRuntime();
    const before = await runtime.stores.resourceState.getByPrefix("org", ORG, "error-reports/");
    const [hit] = await lab.searchHistory(OPERATOR, { query: "error report" });
    await lab.readHistory(OPERATOR, hit!.uri);
    await lab.searchHistory("bob", { query: "error report" });
    expect(await runtime.stores.resourceState.getByPrefix("org", ORG, "error-reports/")).toEqual(before);
  });

  // A user's report outlives their entries: past the hour's cap theirs is only counted, and later
  // occurrences push them out of the five the report keeps. The report still names them.
  it("shows a user their own report when their entry was cut and they left the newest five", async () => {
    const lab = await openLab();
    const at = Date.now();
    const bob = (id: string, when: number) => ({ ...requestOccurrence(id, "the queue is full", when), userId: "bob", sessionId: "breaker-bob" });
    await lab.intake(bob("req_bob_0", at));
    const key = hourKeyOf(at);
    const runtime = await lab.host.state.getRuntime();
    const kept = (await historyOf(lab))[key]!.entries;
    const filler = Array.from({ length: 250 - kept.length }, (_, i) => ({ at: at - 1000 + i, kind: "occurrence", key: `request:old_${i}`, requestId: `old_${i}` }));
    await runtime.stores.resourceState.set("org", ORG, key, { hour: key.slice("error-reports/log-".length), entries: [...kept, ...filler], cut: 0 }, "any");
    await lab.intake(requestOccurrence("req_alice", "the queue is full", at + 1));
    for (let i = 1; i <= 5; i += 1) await lab.intake(bob(`req_bob_${i}`, at + 1 + i));
    const [report] = await lab.rows();
    expect(report!.occurrences.some((o) => o.userId === "alice")).toBe(false);
    expect((await entriesOf(lab)).some((e) => e.userId === "alice")).toBe(false);
    const [hit] = await lab.searchHistory(OPERATOR, { query: "queue" });
    const own = await lab.searchHistory("alice", { query: "error report" });
    expect(own.map((h) => hashOf(h.uri))).toEqual([hashOf(hit!.uri)]);
    // Her words were cut with her entry, and Bob's stay his.
    const read = (await lab.readHistory("alice", own[0]!.uri)).content;
    expect(read).toContain("Error report, waiting in Inbox");
    expect(read).not.toMatch(/req_bob|the queue is full/);
  });

  // What a search or read records is what the caller may read: never the whole history, nor another user's reports.
  it("records only the records the caller may read, never the history they come from", async () => {
    const recorded: string[] = [];
    const lab = await openLab({
      hostRun: (run) => async (r) => {
        const result = await run(r);
        if (r.action === "reports" && (r.input as { op?: string }).op !== "all") recorded.push(JSON.stringify(result.output ?? null));
        return result;
      }
    });
    await lab.intake({ kind: "task", at: Date.now(), taskId: "task_alice_1", boardId: "board_a", attempt: 1, error: "eng.tasker could not do it", userId: "alice", orgId: ORG, assignee: "eng.tasker" });
    await lab.intake({ ...requestOccurrence("req_carol", "the disk is full"), userId: "carol", sessionId: "breaker-carol" });
    recorded.length = 0;
    await lab.searchHistory("bob", { query: "error report" });
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.join("\n")).not.toMatch(/task_alice_1|could not do it|disk is full|req_carol/);
    // The operator's read of one report records that report alone.
    const [hit] = await lab.searchHistory(OPERATOR, { query: "disk" });
    recorded.length = 0;
    await lab.readHistory(OPERATOR, hit!.uri);
    expect(recorded.join("\n")).toContain("disk is full");
    expect(recorded.join("\n")).not.toMatch(/task_alice_1|could not do it/);
  });

  // How much of the org's history was cut is the operator's to know: other users' overflow never shows in a user's record.
  it("shows a user's record the same however much of other users' history was cut", async () => {
    const lab = await openLab();
    const at = Date.now();
    await lab.intake(requestOccurrence("req_alice", "the queue is full", at));
    const [hit] = await lab.searchHistory("alice", { query: "queue" });
    const before = (await lab.readHistory("alice", hit!.uri)).content;
    const key = hourKeyOf(at);
    const runtime = await lab.host.state.getRuntime();
    const kept = (await historyOf(lab))[key]!.entries;
    const filler = Array.from({ length: 250 - kept.length }, (_, i) => ({ at: at - 1000 + i, kind: "occurrence", key: `request:old_${i}`, requestId: `old_${i}` }));
    await runtime.stores.resourceState.set("org", ORG, key, { hour: key.slice("error-reports/log-".length), entries: [...kept, ...filler], cut: 0 }, "any");
    for (let i = 0; i < 3; i += 1) await lab.intake({ ...requestOccurrence(`req_bob_${i}`, "the disk is full", at + 1 + i), userId: "bob", sessionId: "breaker-bob" });
    expect((await historyOf(lab))[key]!.cut).toBeGreaterThan(0);
    expect((await lab.readHistory("alice", hit!.uri)).content).toBe(before);
  });

  // One fingerprint can hold several users' failures (paths and ids are normalized away), so what a user
  // reads of a shared report is built from their own occurrences alone: never another user's words, nor the
  // report's count, issue or drafted title, which come from every user's failures.
  it("shows a user of a shared report only their own words, never another user's", async () => {
    const lab = await openLab();
    await lab.breaks("cannot open /home/alice/secrets/key.pem", "alice");
    await lab.breaks("cannot open /home/bob/notes/todo.txt", "bob");
    const [report] = await lab.rows();
    expect(report!.count).toBe(2);
    const hits = await lab.searchHistory("bob", { query: "error report" });
    expect(hits).toHaveLength(1);
    const read = await lab.readHistory("bob", hits[0]!.uri);
    const seen = [hits[0]!.uri, hits[0]!.snippet, read.content ?? ""].join("\n");
    expect(read.content).toContain("/home/bob/notes/todo.txt");
    expect(seen).not.toMatch(/alice|secrets|key\.pem/);
    // The drafted title is written from every user's failures.
    expect(seen).not.toContain(report!.draft!.title);
    expect(read.content).toContain("Seen 1 time(s)");
  });

  it("shows another org nothing, the operator's own id included", async () => {
    const lab = await openLab();
    await lab.breaks("disk is full");
    expect(await lab.searchHistory(OPERATOR, { query: "error report" }, "other-org")).toEqual([]);
  });
});

/** A fingerprint, as a report's id spells it. */
const FINGERPRINT = /fp-[0-9a-f]{8,}/;
/** What a user reads of a line: its text with every link's address taken out. A bare URL is text, and stays. */
const readText = (text: string) => text.replace(/\]\([^)]*\)/g, "]").replace(/href="[^"]*"/g, "");
const inboxLink: ErrorReporterOptions["inboxLink"] = ({ sessionId }) => `/inbox/${encodeURIComponent(sessionId)}`;

describe("the line when a report starts waiting in Inbox", () => {
  it("names the title, where it came from and the count, and links the operator to the report's Inbox item", async () => {
    const lab = await openLab({ inboxLink });
    await lab.breaks("the queue is full");
    const [report] = await lab.rows();
    const waiting = (await lab.conversationLines()).filter((line) => line.includes("Inbox"));
    expect(waiting).toEqual([
      `Waiting in your Inbox: **Coordinator fails on a project with no repository**, from a failed request (breaker / respond), seen 1 time. [Open it in Inbox](/inbox/${encodeURIComponent(`${REPORT_SESSION_PREFIX}${report!.id}`)})`
    ]);
    expect(readText(waiting[0]!)).not.toMatch(FINGERPRINT);
  });

  // A host may bind the reporter to a conversation that isn't the operator's: the line's own entry decides what it shows there.
  it("writes, in a conversation that is not the operator's, the words with no link it couldn't open", async () => {
    const lab = await openLab({ inboxLink });
    const forOperator = "Waiting in your Inbox: **a title**. [Open it in Inbox](/inbox/x)";
    await lab.open(ERROR_REPORTER_FLOW, "s_alice-reporter", "alice", { workerId: "error-reporter" });
    await lab.line("alice", "s_alice-reporter", { text: "An error report is waiting in the operator's Inbox.", forOperator });
    await lab.line(OPERATOR, CONVERSATION, { text: "An error report is waiting in the operator's Inbox.", forOperator });
    expect((await lab.host.messages("s_alice-reporter")).map((m) => m.text)).toEqual(["An error report is waiting in the operator's Inbox."]);
    expect(await lab.conversationLines()).toEqual([forOperator]);
  });

  it("says where it waits with no link when the Lab names none", async () => {
    const lab = await openLab();
    await lab.breaks("the queue is full");
    const waiting = (await lab.conversationLines()).filter((line) => line.includes("Inbox"));
    expect(waiting).toEqual(["Waiting in your Inbox: **Coordinator fails on a project with no repository**, from a failed request (breaker / respond), seen 1 time."]);
  });

  it("is not written for a report the Lab files without asking: nothing waits", async () => {
    const lab = await openLab({ inboxLink, preview: { autoFile: ["request"] } });
    await lab.breaks("the queue is full");
    const lines = await lab.conversationLines();
    expect(lines).toContainEqual(expect.stringContaining("Filed FIX-9"));
    expect(lines.filter((line) => line.includes("Inbox"))).toEqual([]);
  });
});

// A report's title and where it came from are text others wrote: a drafted title quotes the error,
// a task's title or goal is its creator's. Written into a Markdown line, an image in it would be
// fetched and a link in it would sit beside the line's own; each is shown as the characters typed.
describe("text others wrote, in the Markdown about a report", () => {
  const WRITTEN = "![x](https://attacker.example/i) x) [Open it in Inbox](https://attacker.example)";
  /** `WRITTEN` with every punctuation mark escaped: Markdown shows it as typed, with no image and no link of its own. */
  const LITERAL = String.raw`\!\[x\]\(https\:\/\/attacker\.example\/i\) x\) \[Open it in Inbox\]\(https\:\/\/attacker\.example\)`;
  /** The links and images a Markdown text opens: each `[` or `![` no backslash escapes. */
  const opened = (text: string) => [...text.matchAll(/(?<!\\)!?\[[^\]]*\]\([^)]*\)/g)].map((m) => m[0]);

  it("keeps a drafted title's image and link as text in the waiting line: its Inbox link is the line's only link", async () => {
    const lab = await openLab({ inboxLink, draftTitle: WRITTEN });
    await lab.breaks("the queue is full");
    const [report] = await lab.rows();
    const link = `[Open it in Inbox](/inbox/${encodeURIComponent(`${REPORT_SESSION_PREFIX}${report!.id}`)})`;
    const waiting = (await lab.conversationLines()).filter((line) => line.startsWith("Waiting in your Inbox"));
    expect(waiting).toEqual([`Waiting in your Inbox: **${LITERAL}**, from a failed request (breaker / respond), seen 1 time. ${link}`]);
    expect(opened(waiting[0]!)).toEqual([link]);
  });

  it("keeps a task's goal as text where the waiting line and the preview's question say where the report came from", async () => {
    const lab = await openLab({ inboxLink });
    const conv = await lab.host.conversation("alice");
    const added = await lab.host.act("alice", conv, "createTask_tasks", { goal: `${WRITTEN} [fail]`, assignee: "eng.tasker" });
    expect(added.error, messageOf(added.error)).toBeUndefined();
    await lab.host.settled();
    await lab.reporter.idle();
    await lab.host.settled();
    // The goal's first 80 characters, which here are `WRITTEN` whole.
    const from = `a failed task (${LITERAL})`;
    const waiting = (await lab.conversationLines()).filter((line) => line.startsWith("Waiting in your Inbox"));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toContain(`, from ${from}, seen 1 time.`);
    expect(opened(waiting[0]!)).toEqual([expect.stringMatching(/^\[Open it in Inbox\]\(\/inbox\//)]);
    const [ask] = await lab.asks();
    expect(ask!.message).toBe(`From ${from} · seen 1 time. File it?\n\n**Questions**\n\n- Which team?`);
    expect(opened(ask!.message)).toEqual([]);
  });

  it("keeps a drafted title as text in the line that says it was filed", async () => {
    const lab = await openLab({ draftTitle: WRITTEN, preview: { autoFile: ["request"] } });
    await lab.breaks("the queue is full");
    const filed = (await lab.conversationLines()).filter((line) => line.startsWith("Filed"));
    expect(filed).toEqual([`Filed FIX-9: ${LITERAL} https://tracker.example/FIX-9`]);
  });
});

describe("no fingerprint in what a user reads", () => {
  // Every model-facing answer and every line about a report: a fingerprint in any of them becomes a reply's handle on it.
  it("holds across a report's whole life: its answers, its history record, and every line from waiting to filed to commented", async () => {
    const seen: unknown[] = [];
    const lab = await openLab({ agentAnswer: scriptedReads(seen), inboxLink, limits: { commentEveryMs: 0 } });
    const call = async (tool: string, args: Record<string, unknown>) => {
      const turn = await lab.host.act(OPERATOR, CONVERSATION, "respond", { message: `call ${tool} ${JSON.stringify(args)}` }, ERROR_REPORTER_FLOW);
      expect(turn.error, messageOf(turn.error)).toBeUndefined();
      await lab.reporter.idle();
      return JSON.stringify(seen.at(-1));
    };
    const read: string[] = [];
    read.push(await call("reportProblem", { description: "Checkout total wrong after coupon" }));
    read.push(await call("reportProblem", { description: "Checkout total wrong after coupon" }));
    const [hit] = await lab.searchHistory(OPERATOR, { query: "error report" });
    read.push((await lab.readHistory(OPERATOR, hit!.uri)).content!);
    await lab.answer((await lab.asks())[0]!, { decision: "file" });
    read.push(await call("reportProblem", { description: "Checkout total wrong after coupon" }));
    read.push((await lab.readHistory(OPERATOR, hit!.uri)).content!);
    const lines = await lab.conversationLines();
    // The journey reached each line it should: waiting, filed, commented.
    for (const said of ["Waiting in your Inbox", "Filed FIX-9", "Commented on FIX-9"]) expect(lines).toContainEqual(expect.stringContaining(said));
    for (const text of [...read, ...lines]) expect(readText(text), text).not.toMatch(FINGERPRINT);
  });

  it("files a report whose draft is gone under its error's first line, not its id", async () => {
    const lab = await openLab({ fileFails: 1 });
    await lab.breaks("the queue is full");
    await lab.answer((await lab.asks())[0]!, { decision: "file" });
    const [owed] = await lab.rows();
    const runtime = await lab.host.state.getRuntime();
    const { draft: _gone, ...undrafted } = owed!;
    await runtime.stores.resourceState.set("org", ORG, `error-reports/${owed!.id}`, undrafted, "any");
    await lab.rerun(owed!.id);
    const filed = (await lab.conversationLines()).filter((line) => line.startsWith("Filed"));
    expect(filed).toEqual(["Filed FIX-9: the queue is full https://tracker.example/FIX-9"]);
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
    const [task] = (await lab.host.rows("alice")).filter((t) => t.status === "errored");
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

  // The model repeats what the tool hands it: a fingerprint there became the reply's only handle on the report.
  const reportsVia = async (lab: Lab, seen: unknown[], userId: string, sessionId: string, description: string) => {
    const turn = await lab.host.act(userId, sessionId, "respond", { message: `call reportProblem ${JSON.stringify({ description })}` }, ERROR_REPORTER_FLOW);
    expect(turn.error, messageOf(turn.error)).toBeUndefined();
    await lab.reporter.idle();
    return seen.at(-1) as Record<string, unknown>;
  };

  it("answers that the report is drafting and will wait in Inbox, and a repeat of a waiting one by its title and Inbox link, never a fingerprint", async () => {
    const seen: unknown[] = [];
    const lab = await openLab({ agentAnswer: scriptedReads(seen), inboxLink });
    const first = await reportsVia(lab, seen, OPERATOR, CONVERSATION, "Checkout total wrong after coupon");
    expect(first).toMatchObject({ status: "drafting", waitsIn: "Inbox" });
    expect(JSON.stringify(first)).not.toMatch(FINGERPRINT);

    const again = await reportsVia(lab, seen, OPERATOR, CONVERSATION, "Checkout total wrong after coupon");
    const [report] = await lab.rows();
    expect(again).toMatchObject({
      status: "waiting in Inbox",
      title: "Coordinator fails on a project with no repository",
      inbox: `[Open it in Inbox](/inbox/${encodeURIComponent(`${REPORT_SESSION_PREFIX}${report!.id}`)})`
    });
    // The key may sit in the link's address; nothing else the model reads holds it.
    expect(readText(JSON.stringify(again))).not.toMatch(FINGERPRINT);
  });

  it("gives a user who is not the operator the words with no link and no title: the question waits in the operator's Inbox, which they can't open", async () => {
    const seen: unknown[] = [];
    const lab = await openLab({ agentAnswer: scriptedReads(seen), inboxLink });
    await reportsVia(lab, seen, OPERATOR, CONVERSATION, "Checkout total wrong after coupon");
    await lab.open(ERROR_REPORTER_FLOW, "s_alice-reporter", "alice", { workerId: "error-reporter" });
    const theirs = await reportsVia(lab, seen, "alice", "s_alice-reporter", "Checkout total wrong after coupon");
    expect(theirs).toMatchObject({ status: "waiting in the operator's Inbox" });
    expect(theirs.inbox).toBeUndefined();
    expect(theirs.title).toBeUndefined();
    expect(JSON.stringify(theirs)).not.toMatch(FINGERPRINT);
  });
});

/**
 * A generator that, asked `call <tool> <json>`, calls that tool and records
 * what the tool handed back, so the real tool runs and the test reads its answer.
 */
function scriptedReads(seen: unknown[]): ReturnType<typeof mockGenerator> {
  return {
    name: "error-reporter-answer",
    calls: [],
    reset: () => undefined,
    next: (messages: Array<{ role: string; content: unknown }>, state: { toolResults: Array<{ result: unknown }> }) => {
      if (state.toolResults.length > 0) {
        seen.push(state.toolResults[0]!.result);
        return { text: "done" };
      }
      const turn = JSON.stringify([...messages].reverse().find((m) => m.role === "user")?.content ?? "");
      const call = /call (\w+) (\{.*\})/.exec(JSON.parse(turn) as string);
      if (call === null) return { text: "nothing to call" };
      return { toolCalls: [{ toolCallId: `c${seen.length}`, toolName: call[1]!, args: JSON.parse(call[2]!) }] };
    }
  } as unknown as ReturnType<typeof mockGenerator>;
}

describe("asked what it reported", () => {
  // Its own turn answers from the history, never from the task board or another worker.
  it("searches and reads the error history with the general resource tools", async () => {
    const seen: unknown[] = [];
    const lab = await openLab({ agentAnswer: scriptedReads(seen) });
    await lab.breaks("disk is full");
    const ask = async (message: string) => {
      const turn = await lab.host.act(OPERATOR, CONVERSATION, "respond", { message }, ERROR_REPORTER_FLOW);
      expect(turn.error, messageOf(turn.error)).toBeUndefined();
    };
    await ask('call searchResources {"query":"disk full error report","prefix":null}');
    const found = JSON.stringify(seen[0]);
    const uri = /org\/error-history\/[^"]+/.exec(found)?.[0];
    expect(uri, found).toBeDefined();
    await ask(`call readResourceContent {"uri":"${uri}"}`);
    expect(JSON.stringify(seen[1])).toContain("waiting in Inbox");
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
    let entry = sent;
    for (let i = 0; i < 150 && entry?.status !== "delivered"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      [entry] = await rows();
    }
    expect(entry).toMatchObject({ status: "delivered", resent: { n: 1 } });
  }, 30_000);
});

describe("the ledger's owed report", () => {
  const legacyTask = { id: "t1", attempts: 2, metadata: {} } as never;

  it("is read off a task stored before FIX-2078 only: nothing writes one now", () => {
    expect(owedReports(legacyTask)).toEqual([]);
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
