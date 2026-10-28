/** What this run proves is `goal.md` beside this file. */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { handler } from "@flow-state-dev/core";
import type { FlowInstance, GeneratorModel, HarnessBlock, ModelResolver } from "@flow-state-dev/core/types";
import { createModelResolver, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { deriveWorkerSessionId, ERROR_REPORTER_FLOW, ERROR_REPORTER_INTAKE_FLOW, INTAKE_SESSION_ID, type ReportRow } from "@flow-state-dev/workforce";
import { z } from "zod";
import {
  assertPatched,
  describePatches,
  goalTmpDir,
  modulePatchEnv,
  REPO_ROOT,
  runGoal,
  silentLogger,
  stripIntentOverrides,
  type ModulePatch,
} from "../../lib/index.mts";
import { harnessStub } from "../../../packages/shift-manager/teams/devteam/harness-stub.mts";
import { errorReporterHarness } from "../../../packages/shift-manager/teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab, type LabErrorReporter } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { workerSessionId } from "../../../packages/shift-manager/teams/devteam/ask.mts";
import { createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";
import { LIST_TASKS_ACTION } from "../../../packages/shift-manager/src/lib/conversation-tasks.ts";
import { connect } from "../../../packages/shift-manager/src/lib/connection.ts";
import { createLabReader, type Ask } from "../../../packages/shift-manager/src/lib/reads.ts";
import { parseRoute } from "../../../packages/shift-manager/src/lib/routes.ts";
import { plantedAgentModel, plantedCoderRun, plantedCoderStatus, plantedCoordinatorModel, type KnownProject } from "./plant.mts";
import { startRecordingTracker, type TrackerCall } from "./recording-tracker.mts";

const SLUG = "error-reporter-files-a-reproducible-issue";
const say = (line: string) => console.log(`[${SLUG}] ${line}`);

// ---- controls ---------------------------------------------------------------

const FLOW = "packages/workforce/src/error-reporter/flow.ts";
const REPORTS = "packages/workforce/src/error-reporter/reports.ts";
const REPORTER_SRC = "packages/workforce/src/error-reporter/reporter.ts";
const OWED = "packages/workforce/src/conversation-board/report-owed.ts";
const COORDINATOR_SRC = "packages/workforce/src/coordinator/coordinator-flow.ts";
const POST_SRC = "packages/workforce/src/coordinator/delegated-post.ts";

const CONTROLS: Record<string, { legs: string[]; does: string; fails: string; patches: ModulePatch[] }> = {
  "via-coordinator": {
    legs: ["1"],
    does: "the reporter's intake runs on the Shift Coordinator's flow instead of its own",
    fails: "leg 1: one report in Inbox",
    patches: [{ module: REPORTER_SRC, from: '\\{ occurrence: await intakeOf\\(event\\) \\}, "internal", ERROR_REPORTER_INTAKE_FLOW\\)', to: '{ occurrence: await intakeOf(event) }, "internal", "coordinator")' }],
  },
  "stack-only": {
    legs: ["1"],
    does: "the issue holds the error alone: the draft's title and body are replaced by the error message",
    fails: "leg 1: the replay trips the same fingerprint",
    patches: [
      { module: FLOW, from: "const body = redact\\(composeIssueBody\\(draft, row\\), secrets\\);", to: "const body = row.parts.message;" },
      { module: FLOW, from: "return \\{ title: draft\\.title, body, questions: draft\\.questions \\?\\? \\[\\] \\};", to: "return { title: row.parts.message.slice(0, 120), body, questions: draft.questions ?? [] };" },
    ],
  },
  "skip-preview": {
    legs: ["1"],
    does: "a draft files without waiting for the operator",
    fails: "leg 1: nothing filed before the answer",
    patches: [{ module: FLOW, from: "if \\(ctx\\.suspend === undefined\\) \\{", to: 'if (true) return { decision: "file" as const, ...draft }; if (ctx.suspend === undefined) {' }],
  },
  "no-dedupe": {
    legs: ["2"],
    does: "every occurrence gets a report row of its own",
    fails: "leg 2: one report",
    patches: [{ module: REPORTS, from: "const key = reportKey\\(fingerprint\\);", to: "const key = reportKey(fingerprint + String(now));" }],
  },
  "no-cap": {
    legs: ["3"],
    does: "the cap on new reports per window is off",
    fails: "leg 3: at most 5 reports",
    patches: [{ module: REPORTS, from: "if \\(cap\\.fingerprints\\.length >= limits\\.newPerWindow\\)", to: "if (false)" }],
  },
  eager: {
    legs: ["4"],
    does: "a task's failed attempt is reported even when the task retries",
    fails: "leg 4: no report for a task that passed on retry",
    patches: [{ module: OWED, from: 'if \\(ending\\.kind !== "errored"\\) return row;', to: 'if (ending.kind !== "errored" && ending.kind !== "retried") return row;' }],
  },
  "rescue-unreported": {
    legs: ["C"],
    does: "the chief of staff's rescued crash is answered and not reported",
    fails: "leg C: the chief of staff's own crash reaches Inbox",
    patches: [{ module: COORDINATOR_SRC, from: "await reportRescuedFailure\\(ctx as never, \\{", to: "if (false) await reportRescuedFailure(ctx as never, {" }],
  },
  "post-on-touch": {
    legs: ["C"],
    does: "a delegate's failed post is sent to the reporter only on the board's next touch",
    fails: "leg C: the delegate's failed post reaches Inbox",
    patches: [{ module: POST_SRC, from: "await sendOwedReports\\(ctx, ref, \\[row\\]", to: "if (false) await sendOwedReports(ctx, ref, [row]" }],
  },
  "no-redact": {
    legs: ["5"],
    does: "the dossier reaches the harness unredacted",
    fails: "leg 5: no secret in a report",
    patches: [{ module: FLOW, from: "const dossier = redact\\(await reporter\\.dossierOf\\(row\\), secrets\\);", to: "const dossier = await reporter.dossierOf(row);" }],
  },
};

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL === "list") {
  for (const [name, c] of Object.entries(CONTROLS)) console.log(`${name}: ${c.does} — must FAIL ${c.fails}`);
  process.exit(0);
}
if (CONTROL !== "" && !Object.hasOwn(CONTROLS, CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = CONTROL === "" ? undefined : CONTROLS[CONTROL]!;

// A control runs this same script in a child process whose modules are patched as they load.
const SCRATCH = goalTmpDir(SLUG);
const MARK = join(SCRATCH, "patch-mark");
if (control !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  rmSync(MARK, { force: true });
  say(`control ${CONTROL}: ${control.does}\n${describePatches(control.patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(control.patches, REPO_ROOT, MARK) },
  });
  assertPatched(control.patches, REPO_ROOT, MARK);
  process.exit(child.status ?? 1);
}
const runs = (leg: string) => control === undefined || control.legs.includes(leg);

// ---- the environment ----------------------------------------------------------

stripIntentOverrides();
if ((process.env.ANTHROPIC_API_KEY ?? "") === "" && (process.env.MY_ANTHROPIC_API_KEY ?? "") !== "") {
  process.env.ANTHROPIC_API_KEY = process.env.MY_ANTHROPIC_API_KEY;
}
/** A value the Lab names as secret; the leg-1 message carries it, and no report may. */
const LAB_SECRET = `ghp_goalLabSecret${Date.now()}x7`;
/** The Lab user's tracker key, set through the key route as Settings sets it. */
const MCP_KEY = `lin_api_goalRecordingKey${Date.now()}z9`;

const CHIEF = "chief-of-staff";
/**
 * The coordinator most planted failures are sent to: Sandbox's project
 * coordinator. Its routing is `judgment`, so a failure in its turn fails the
 * request. Leg C sends them to the chief of staff, whose `best-fit` routing
 * answers a crash in its own turn with "Nobody took this message".
 */
const PROJECT_COORDINATOR = "project-coordinator";
const CODER = "eng.coder";
const POST_TAKER = "researcher";
const REPORTER = "error-reporter";
const FSD = { visibility: "shared" as const, id: "fsd" };
/** The model the project coordinator runs, as its WORKER.md declares it. */
const COORDINATOR_MODEL = /^model:\s*(\S+)\s*$/m.exec(
  readFileSync(join(REPO_ROOT, "packages/shift-manager/teams/devteam/workforce/org/workers/project-coordinator/WORKER.md"), "utf8")
)![1]!;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DRAFT_MS = 20 * 60_000;

/** The leg-1 message: it names a project with no repository, and carries a token no report may hold. */
const LEG1_MESSAGE = `What's the status of the Sandbox project? Use my deploy token ${LAB_SECRET} if you need it.`;
const OPERATOR_ANSWER = "Label it P1 and say which model the coordinator ran.";
const BURST_WORDS = [
  "amber", "basil", "cedar", "delta", "ember", "fable", "garnet", "harbor", "indigo", "juniper",
  "kelp", "lumen", "maple", "nectar", "onyx", "pepper", "quartz", "raven", "saffron", "tundra",
  "umber", "violet", "willow", "xenon", "yarrow", "zephyr", "acorn", "bramble", "cobalt", "dune",
];

/** Poll `read` until it returns a value, or give up after `ms`. */
async function until<T>(read: () => Promise<T | undefined>, ms: number, every = 2_000): Promise<T | undefined> {
  for (const deadline = Date.now() + ms; ; await sleep(every)) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) return undefined;
  }
}

/** `coordinator-judgment` is the planted model; every other block is real. */
function labModels(projects: readonly KnownProject[]): ModelResolver {
  const base = createModelResolver();
  const resolver = ((id: string, block?: string) => {
    if (block === "coordinator-route-ask") throw new Error("no route model in this check");
    if (block === "coordinator-judgment") return plantedCoordinatorModel(base.resolveId?.(id) ?? id, projects);
    if (block === "agent-answer") return plantedAgentModel(base(id, block) as GeneratorModel);
    return base(id, block);
  }) as ModelResolver;
  return Object.assign(resolver, { resolveId: (id: string) => base.resolveId?.(id) ?? id });
}

/** A harness that throws: the reporter's own planted failure (leg 6). */
const brokenReporterHarness = (): HarnessBlock =>
  handler({
    name: "planted-broken-reporter-harness",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async () => {
      throw new Error("planted: the reporter's harness could not start");
    },
  }) as unknown as HarnessBlock;

/** A harness that drafts without a model: only for the clean replay Lab and leg 3, where the draft isn't graded. */
const draftingStub = (): HarnessBlock =>
  handler({
    name: "replay-drafting-stub",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async () => ({
      source: "goal/stub",
      status: "completed",
      sessionId: null,
      url: null,
      dispatchedAt: Date.now(),
      outcome: "finished",
      finalMessage: '```json\n{"title":"stub draft"}\n```',
      usage: null,
      cost: null,
    }),
  }) as unknown as HarnessBlock;

interface Opened {
  lab: Lab;
  baseUrl: string;
  close(): Promise<void>;
  /** Every report row. */
  rows(): Promise<ReportRow[]>;
  /** Inbox's asks, as Shift Manager reads them, on report sessions. */
  reportAsks(): Promise<Ask[]>;
  /** Answer an ask the way Inbox's card does. */
  answer(ask: Ask, data: Record<string, unknown>): Promise<void>;
  /** Send a message to the chief of staff; the request id and whether it failed. */
  tellChief(message: string): Promise<{ requestId: string; failed: boolean; error?: string }>;
  /** Send a message to a project's project coordinator, opening its session the first time. */
  tellProject(projectId: string, message: string): Promise<{ requestId: string; failed: boolean; error?: string }>;
  /** The chief of staff's tasks. */
  tasks(): Promise<Array<Record<string, any>>>;
  addDelegate(worker: string): Promise<void>;
  chiefSession: string;
}

/** Open the devteam Lab with the reporter, serve it, and give the legs their reads. */
async function open(options: {
  store: "memory" | string;
  tracker: { url: string } | undefined;
  harness: LabErrorReporter["harness"];
  limits?: LabErrorReporter["limits"];
}): Promise<Opened> {
  const remote = createBareRemote("error-reporter-fsd");
  const projects: KnownProject[] = [
    { id: "fsd", title: "FSD", repository: remote.url },
    { id: "sandbox", title: "Sandbox" },
  ];
  mkdirSync(join(SCRATCH, "runs"), { recursive: true });
  const lab = await openLab({
    stores: options.store === "memory" ? inMemoryStores() : sqliteStores({ filename: options.store }),
    harness: harnessStub({ duringRun: plantedCoderRun, statusOf: plantedCoderStatus, outcomeOf: (run) => (plantedCoderStatus(run) === "errored" ? "failed" : "finished"), finalMessage: "Done." }).slot,
    runTimeoutMs: 60_000,
    workspace: { root: join(SCRATCH, "runs"), remotes: { allow: ["file"] } },
    coderWorkerId: CODER,
    inventory: true,
    devtool: true,
    projects: [
      { id: "fsd", title: "FSD", brief: "The framework.", repository: remote.url, ...(options.tracker === undefined ? {} : { mcpServers: ["linear"] }) },
      { id: "sandbox", title: "Sandbox", brief: "A prototype with no repository yet." },
    ],
    ...(options.tracker === undefined ? {} : { mcpServers: { linear: { url: options.tracker.url } } }),
    modelResolver: labModels(projects),
    logger: silentLogger,
    log: (line) => say(line),
    errorReporter: {
      harness: options.harness,
      cwd: REPO_ROOT,
      ...(options.tracker === undefined ? {} : { tracker: { project: "shared/fsd" } }),
      secrets: () => [LAB_SECRET],
      // The window is the run's length.
      limits: { windowMs: 6 * 60 * 60_000, ...(options.limits ?? {}) },
    },
  });
  if (options.tracker !== undefined) {
    const set = await lab.door("POST", "mcp-credentials/linear", { body: { value: MCP_KEY } });
    if (set.status !== 200) throw new Error(`setting the tracker key answered ${set.status}`);
  }
  const handle = await serve(lab.state, { host: "127.0.0.1", port: 0, basePath: "/api/flows", handleSignals: false });
  const baseUrl = `http://127.0.0.1:${handle.port}`;
  const devtool = lab.state.meta.devtool!;
  const client = connect({ baseUrl, userId: devtool.userId ?? LAB_USER_ID, bearerToken: devtool.bearerToken! });
  const reader = createLabReader(client);
  const runtime = await lab.state.getRuntime();
  const intake = runtime.registry.get(ERROR_REPORTER_INTAKE_FLOW) as FlowInstance;
  const coordinator = runtime.registry.get("coordinator") as FlowInstance;

  const chiefSession = `s-goal-chief-${Date.now()}`;
  const created = await lab.door("POST", "coordinator/sessions", { body: { userId: LAB_USER_ID, sessionId: chiefSession, state: { workerId: CHIEF } } });
  if (created.status !== 201) throw new Error(`opening the chief of staff's session answered ${created.status}`);
  const projectSessions = new Map<string, string>();
  const projectSession = async (projectId: string) => {
    const known = projectSessions.get(projectId);
    if (known !== undefined) return known;
    const projectRef = { visibility: "shared" as const, id: projectId };
    const sessionId = await deriveWorkerSessionId({ userId: LAB_USER_ID, orgId: LAB_ORG_ID, flow: "coordinator", criteria: { worker: PROJECT_COORDINATOR, projectId: projectRef } } as never);
    const opened = await lab.door("POST", "coordinator/sessions", { body: { userId: LAB_USER_ID, sessionId, state: { workerId: PROJECT_COORDINATOR, projectId: `shared/${projectId}` } } });
    if (opened.status !== 201 && opened.status !== 200 && opened.status !== 409) throw new Error(`opening ${projectId}'s project coordinator answered ${opened.status}: ${JSON.stringify(opened.body)}`);
    projectSessions.set(projectId, sessionId);
    return sessionId;
  };
  const act = async (flow: FlowInstance, sessionId: string, actionName: string, input: unknown, source?: string) =>
    (await runAction({
      orgId: LAB_ORG_ID,
      flow,
      actionName,
      input,
      userId: LAB_USER_ID,
      sessionId,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
      ...(source === undefined ? {} : { source }),
    } as never)) as { output?: any; error?: any; requestId?: string };

  const told = (result: { error?: any; requestId?: string }) => ({
    requestId: result.requestId!,
    failed: result.error !== undefined,
    ...(result.error === undefined ? {} : { error: JSON.stringify(result.error).slice(0, 300) }),
  });

  return {
    lab,
    baseUrl,
    chiefSession,
    close: async () => {
      await handle.close();
      await lab.dispose();
    },
    rows: async () => {
      const result = await act(intake, INTAKE_SESSION_ID, "reports", { op: "all" }, "internal");
      if (result.error !== undefined) throw new Error(`reading the report rows failed: ${JSON.stringify(result.error)}`);
      return (result.output?.rows ?? []) as ReportRow[];
    },
    reportAsks: async () => {
      const snapshot = await reader.read();
      if (snapshot.refused !== undefined || snapshot.unreachable !== undefined || !snapshot.asks.ok) {
        throw new Error(`Inbox did not load: ${JSON.stringify(snapshot.refused ?? snapshot.unreachable ?? (snapshot.asks as { failure?: unknown }).failure)}`);
      }
      return snapshot.asks.value.filter((ask) => ask.sessionId.startsWith("error-report~"));
    },
    answer: (ask, data) => reader.resume(ask, { action: "submit", data }),
    tellChief: async (message) => told(await act(coordinator, chiefSession, "respond", { message })),
    tellProject: async (projectId, message) => told(await act(coordinator, await projectSession(projectId), "respond", { message })),
    tasks: async () => ((await act(coordinator, chiefSession, LIST_TASKS_ACTION, {})).output?.tasks ?? []) as Array<Record<string, any>>,
    addDelegate: async (worker) => {
      const added = await act(coordinator, chiefSession, "addDelegate", { worker });
      if (added.error !== undefined) throw new Error(`adding ${worker} as a delegate failed: ${JSON.stringify(added.error)}`);
    },
  };
}

/** Dispatch one task through the chief of staff, and wait for it to settle. */
async function runTask(lab: Opened, goal: string, maxAttempts: number): Promise<Record<string, any> | undefined> {
  const before = new Set((await lab.tasks()).map((t) => t.id));
  const filed = await lab.tellChief(`dispatch ${JSON.stringify({ goal, assignee: CODER, input: { project: FSD }, maxAttempts })}`);
  if (filed.failed) throw new Error(`filing "${goal}" failed: ${filed.error}`);
  return until(async () => {
    const task = (await lab.tasks()).find((t) => !before.has(t.id) && String(t.goal ?? t.title).includes(goal));
    return task !== undefined && ["completed", "errored", "cancelled"].includes(task.status) ? task : undefined;
  }, 5 * 60_000);
}

/** Any of `secrets` in `value`, by name. */
function secretsIn(value: unknown, secrets: Record<string, string>): string[] {
  const text = JSON.stringify(value ?? null);
  return Object.entries(secrets).filter(([, secret]) => text.includes(secret)).map(([name]) => name);
}

/** What a second Claude Code run makes of the issue alone: the worker to message, and the message. */
async function replayOf(issue: { title: string; description: string }): Promise<{ worker: string; project?: string; message: string } | undefined> {
  const cwd = join(SCRATCH, "replay");
  mkdirSync(cwd, { recursive: true });
  const prompt = [
    "Below is a bug report filed against a Shift Manager Lab, a team of AI workers people chat with.",
    "You will reproduce it in a fresh Lab running the same code, by sending ONE chat message to ONE worker.",
    "A worker that runs one session per project (a project coordinator) also needs the project's id.",
    "Use only what the report says. Reply with only a JSON object, no fence: {\"worker\": \"<the worker's id>\", \"project\": \"<the project's id, or omit>\", \"message\": \"<the exact message to send>\"}",
    "",
    `Title: ${issue.title}`,
    "",
    issue.description,
  ].join("\n");
  let text = "";
  for await (const message of query({ prompt, options: { cwd, maxTurns: 1, allowedTools: [], disallowedTools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "WebFetch", "WebSearch"] } as never })) {
    if ((message as { type?: string }).type === "result") text = String((message as { result?: unknown }).result ?? "");
  }
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  try {
    const parsed = JSON.parse(json ?? "") as { worker?: unknown; project?: unknown; message?: unknown };
    if (typeof parsed.worker !== "string" || typeof parsed.message !== "string") return undefined;
    return { worker: parsed.worker, message: parsed.message, ...(typeof parsed.project === "string" ? { project: parsed.project } : {}) };
  } catch {
    return undefined;
  }
}

await runGoal(async (failures) => {
  mkdirSync(SCRATCH, { recursive: true });
  if ((process.env.ANTHROPIC_API_KEY ?? "") === "") {
    return { failures: ["blocked: no ANTHROPIC_API_KEY (or MY_ANTHROPIC_API_KEY) for Claude Code"], evidence: "" };
  }
  const evidence: string[] = [];
  const store = join(SCRATCH, `lab-${Date.now()}.sqlite`);
  const tracker = await startRecordingTracker(MCP_KEY);
  const fail = (leg: string, what: string) => {
    failures.push(`leg ${leg}: ${what}`);
    say(`FAIL leg ${leg}: ${what}`);
  };
  const SECRETS = { "the Lab's secret": LAB_SECRET, "the tracker key": MCP_KEY, "ANTHROPIC_API_KEY": process.env.ANTHROPIC_API_KEY! };
  let lab: Opened | undefined;
  try {
    const needsLabA = ["1", "2", "4", "5", "6", "7"].some(runs);
    let leg1: { row: ReportRow; requestId: string } | undefined;
    let leg2Row: ReportRow | undefined;
    if (needsLabA) {
      // A control that grades no draft (legs 2 and 4) drafts with the stub, not a paid Claude Code run.
      const drafts = control === undefined || control.legs.some((leg) => leg === "1" || leg === "5");
      lab = await open({ store, tracker, harness: drafts ? errorReporterHarness : draftingStub });
      say(`Lab A open at ${lab.baseUrl}, store ${store}`);

      // ---- leg 1 ---------------------------------------------------------------
      if (runs("1") || runs("5") || runs("2")) {
        const sent = await lab.tellProject("sandbox", LEG1_MESSAGE);
        say(`leg 1: the message ${sent.failed ? "tripped the bug" : "did NOT trip the bug"} (request ${sent.requestId}${sent.error === undefined ? "" : `: ${sent.error}`})`);
        if (!sent.failed) fail("1", "the planted message did not fail the coordinator's turn");
        const waitForDraft = runs("1") || runs("5");
        const row = await until(async () => {
          const found = (await lab!.rows()).find((r) => r.occurrences.some((o) => o.requestId === sent.requestId));
          return found !== undefined && (!waitForDraft || ["previewing", "filed"].includes(found.status)) ? found : undefined;
        }, waitForDraft ? DRAFT_MS : 60_000);
        if (row === undefined) fail("1", "one report in Inbox: no report row for the failed request");
        else leg1 = { row, requestId: sent.requestId };
      }

      if (runs("1") && leg1 !== undefined) {
        // Let the report's run reach wherever it stops on its own: the preview, or a filed issue.
        await lab.lab.errorReporter!.idle();
        const asks = await lab.reportAsks();
        const mine = asks.filter((a) => a.sessionId === leg1!.row.sessionId);
        say(`leg 1: ${asks.length} report ask(s) in Inbox, ${mine.length} for this report; ${tracker.calls.length} tracker call(s) before the answer`);
        if (mine.length !== 1 || asks.length !== 1) fail("1", `one report in Inbox: ${asks.length} report asks, ${mine.length} for this report`);
        if (mine[0]?.unanswerable != null) fail("1", `the ask is unanswerable: ${mine[0].unanswerable}`);
        if (tracker.calls.some((c) => c.tool === "create_issue")) fail("1", "nothing filed before the answer: an issue was filed before the operator answered");
        // The ids are the store's.
        const runtime = await lab.lab.state.getRuntime();
        const record = await runtime.stores.request.get(leg1.requestId);
        const ids = leg1.row.occurrences.find((o) => o.requestId === leg1!.requestId)!;
        for (const [name, want] of Object.entries({ request: record?.id, session: record?.sessionId, user: record?.userId })) {
          const got = name === "request" ? ids.requestId : name === "session" ? ids.sessionId : ids.userId;
          if (want === undefined || got !== want) fail("1", `the report's ${name} id is ${got}, the store's is ${want}`);
        }
        const draftBody = String((mine[0]?.item as { data?: { body?: unknown } } | undefined)?.data?.body ?? "");
        for (const id of [record?.id, record?.sessionId, record?.userId]) {
          if (id !== undefined && !draftBody.includes(id)) fail("1", `the draft in Inbox doesn't carry ${id}`);
        }

        if (mine.length > 0) {
          await lab.answer(mine[0]!, { decision: "file", instructions: OPERATOR_ANSWER });
          say("leg 1: answered File, with the operator's instructions");
          const filed = await until(async () => {
            const now = (await lab!.rows()).find((r) => r.id === leg1!.row.id);
            return now?.status === "filed" || now?.lastRunError !== undefined ? now : undefined;
          }, DRAFT_MS);
          const issues = tracker.calls.filter((c) => c.tool === "create_issue");
          say(`leg 1: row ${filed?.status ?? "never filed"}; ${issues.length} issue(s) filed: ${issues.map((c) => String(c.args.title)).join(" | ")}`);
          if (issues.length !== 1) fail("1", `exactly one issue filed: ${issues.length}`);
          const issue = tracker.issues[0];
          if (issue !== undefined) {
            const all = JSON.stringify({ title: issue.title, description: issue.description, labels: issue.labels });
            if (!/\bP1\b/i.test(all) && issue.priority !== 1) fail("1", "the issue doesn't say P1");
            if (!issue.description.includes(COORDINATOR_MODEL)) fail("1", `the issue doesn't say the coordinator's model, ${COORDINATOR_MODEL}`);
            for (const id of [record?.id, record?.sessionId, record?.userId]) {
              if (id !== undefined && !issue.description.includes(id)) fail("1", `the issue doesn't carry ${id}`);
            }
            evidence.push(`leg 1: ${issue.identifier} "${issue.title}" labels ${JSON.stringify(issue.labels)} priority ${issue.priority}`);

            // The replay: a second Claude Code run, given only the issue, in a clean Lab.
            const replay = await replayOf(issue);
            say(`leg 1 replay: ${replay === undefined ? "no worker and message" : `${replay.worker}${replay.project === undefined ? "" : ` (${replay.project})`} ← "${replay.message}"`}`);
            if (replay === undefined) fail("1", "the replay trips the same fingerprint: the replay named no worker and message");
            else {
              const clean = await open({ store: "memory", tracker: undefined, harness: draftingStub });
              try {
                const worker = clean.lab.installation.standardWorker(replay.worker);
                if (worker === undefined || worker.declared.flow !== "coordinator") {
                  fail("1", `the replay trips the same fingerprint: the replay messaged "${replay.worker}", not a coordinator worker`);
                } else {
                  const tripped =
                    replay.worker === PROJECT_COORDINATOR
                      ? await clean.tellProject((replay.project ?? "").replace(/^shared\//, "").toLowerCase(), replay.message)
                      : replay.worker === CHIEF
                        ? await clean.tellChief(replay.message)
                        : undefined;
                  if (tripped === undefined) throw new Error(`the replay named ${replay.worker}, which this check can't message`);
                  const replayRow = await until(async () => (await clean.rows()).find((r) => r.occurrences.some((o) => o.requestId === tripped.requestId)), 60_000);
                  say(`leg 1 replay: ${tripped.failed ? "failed" : "passed"}; fingerprint ${replayRow?.fingerprint ?? "none"} vs ${leg1.row.fingerprint}`);
                  if (replayRow?.fingerprint !== leg1.row.fingerprint) fail("1", "the replay trips the same fingerprint: it did not");
                  else evidence.push("leg 1: the replay tripped the same fingerprint");
                }
              } finally {
                await clean.close();
              }
            }
          }
        }
      }

      // ---- leg 2 ---------------------------------------------------------------
      if (runs("2")) {
        const asksBefore = control === undefined ? (await lab.reportAsks()).length : 0;
        for (let i = 0; i < 10; i += 1) await lab.tellProject("sandbox", LEG1_MESSAGE);
        await sleep(3_000);
        const message = leg1?.row.parts.message;
        const matching = message === undefined ? [] : (await lab.rows()).filter((r) => r.kind === "report" && r.parts.message === message);
        leg2Row = matching[0];
        say(`leg 2: ${matching.length} report(s) for the failure, count ${leg2Row?.count}`);
        if (matching.length !== 1) fail("2", `one report: ${matching.length} reports for one failure`);
        if (leg2Row?.count !== 11) fail("2", `count 11: ${leg2Row?.count}`);
        if (control === undefined) {
          const asksAfter = (await lab.reportAsks()).length;
          if (asksAfter !== asksBefore) fail("2", `no second Inbox card: ${asksBefore} asks before, ${asksAfter} after`);
        }
        evidence.push(`leg 2: one report, count ${leg2Row?.count}`);
      }

      // ---- leg 4 ---------------------------------------------------------------
      if (runs("4")) {
        const before = (await lab.rows()).length;
        const task = await runTask(lab, "Write the changelog entry [flaky]", 2);
        await lab.lab.errorReporter!.idle();
        const after = await lab.rows();
        say(`leg 4: the flaky task ${task?.status ?? "never settled"} after ${task?.attempts ?? "?"} attempt(s); ${after.length - before} new report(s)`);
        if (task?.status !== "completed") fail("4", `the flaky task did not pass on retry: ${task?.status}`);
        if (after.length !== before || after.some((r) => r.task?.error?.includes("locked"))) fail("4", "no report for a task that passed on retry: one was made");
        else evidence.push("leg 4: no report for a task that passed on retry");
      }

      if (control === undefined) {
        // ---- leg H: the bug in a worker's harness run --------------------------
        const harnessTask = await runTask(lab, "Build the release [harness-bug]", 1);
        say(`leg H: the task ${harnessTask?.status}`);
        const harnessRow = await until(async () => {
          const found = (await lab!.rows()).filter((r) => r.source === "task" && r.occurrences.some((o) => o.taskId === harnessTask?.id));
          return found.length > 0 && found.every((r) => ["previewing", "filed"].includes(r.status)) ? found : undefined;
        }, DRAFT_MS);
        if (harnessRow?.length !== 1) fail("H", `one report for the harness bug: ${harnessRow?.length ?? 0}`);
        else {
          const ask = (await lab.reportAsks()).find((a) => a.sessionId === harnessRow[0]!.sessionId);
          const body = String((ask?.item as { data?: { body?: unknown } } | undefined)?.data?.body ?? "");
          // The task's link among whatever else the draft quotes (a source path, a route template).
          const links = [...body.matchAll(/(?<![\w.-])(\/tasks\/[^)\s`]+)/g)].map((m) => m[1]!);
          const routes = links.map((l) => ({ l, route: parseRoute(l) }));
          const hit = routes.find((r) => r.route?.level === "task" && r.route.taskId === harnessTask?.id);
          const link = hit === undefined ? (links.length === 0 ? null : [links.join(" ")]) : [hit.l];
          const route = hit?.route;
          if (ask === undefined) fail("H", "its report is not in Inbox");
          if (route?.level !== "task" || route.taskId !== harnessTask?.id) fail("H", `its link doesn't open the task: ${link?.[0] ?? "no link"}`);
          else evidence.push(`leg H: one report in Inbox, its link opens task ${route.taskId}`);
        }

        // ---- leg 7: errored with no thrown failure ------------------------------
        const quietTask = await runTask(lab, "Tidy the docs [gives-up]", 1);
        say(`leg 7: the task ${quietTask?.status}`);
        const quietRows = await until(async () => {
          const found = (await lab!.rows()).filter((r) => r.occurrences.some((o) => o.taskId === quietTask?.id));
          return found.length > 0 ? found : undefined;
        }, 60_000);
        if (quietTask?.status !== "errored") fail("7", `the task didn't end errored: ${quietTask?.status}`);
        if (quietRows?.length !== 1) fail("7", `exactly one report: ${quietRows?.length ?? 0}`);
        else evidence.push("leg 7: one report for a task that ended errored with no thrown failure");

        // ---- leg M: a person reports a problem ---------------------------------
        const issuesBefore = tracker.calls.filter((c) => c.tool === "create_issue").length;
        const runtime = await lab.lab.state.getRuntime();
        const reporterFlow = runtime.registry.get(ERROR_REPORTER_FLOW) as FlowInstance;
        const told = (await runAction({
          orgId: LAB_ORG_ID,
          flow: reporterFlow,
          actionName: "respond",
          input: { message: "The storefront task shows as done in Tasks, but nothing ran and there's no branch for it. Can you look into it?" },
          userId: LAB_USER_ID,
          sessionId: workerSessionId(REPORTER),
          stores: runtime.stores,
          runtimeConfig: runtime.runtimeConfig,
        } as never)) as { error?: unknown };
        if (told.error !== undefined) fail("M", `the reporter's turn failed: ${JSON.stringify(told.error).slice(0, 300)}`);
        const manual = await until(async () => {
          const found = (await lab!.rows()).filter((r) => r.source === "manual");
          return found.length > 0 && found.every((r) => ["previewing", "filed"].includes(r.status)) ? found : undefined;
        }, DRAFT_MS);
        const manualAsks = manual === undefined ? [] : (await lab.reportAsks()).filter((a) => manual.some((r) => r.sessionId === a.sessionId));
        say(`leg M: ${manual?.length ?? 0} manual report(s), ${manualAsks.length} in Inbox`);
        if (manual?.length !== 1) fail("M", `exactly one report: ${manual?.length ?? 0}`);
        if (manualAsks.length !== 1) fail("M", `it reaches Inbox: ${manualAsks.length} asks`);
        if (tracker.calls.filter((c) => c.tool === "create_issue").length !== issuesBefore) fail("M", "nothing filed before the operator answers: an issue was filed");
        if (manual?.length === 1 && manualAsks.length === 1) evidence.push("leg M: a person's report reached Inbox as one report, nothing filed");

        await lab.lab.errorReporter!.idle();
        await lab.close();
        lab = undefined;

        // ---- leg 6: the reporter's own failure, then a restart ----------------
        lab = await open({ store, tracker, harness: brokenReporterHarness });
        const planted = await lab.tellProject("sandbox", "burst: harbor");
        const stuck = await until(async () => {
          const row = (await lab!.rows()).find((r) => r.occurrences.some((o) => o.requestId === planted.requestId));
          return row !== undefined && row.runs >= 1 ? row : undefined;
        }, 120_000);
        await lab.lab.errorReporter!.idle();
        const selfReports = (await lab.rows()).filter((r) => [ERROR_REPORTER_FLOW, ERROR_REPORTER_INTAKE_FLOW].includes(r.parts.flowKind));
        const stuckNow = stuck === undefined ? undefined : (await lab.rows()).find((r) => r.id === stuck.id);
        say(`leg 6: under the plant the report is ${stuckNow?.status ?? "missing"} after ${stuckNow?.runs ?? 0} run(s); ${selfReports.length} report(s) of the reporter itself`);
        if (stuckNow === undefined || !["owed", "drafting"].includes(stuckNow.status)) fail("6", `the report is left unfiled: ${stuckNow?.status}`);
        if (selfReports.length > 0) fail("6", "the reporter reported itself");
        await lab.close();
        lab = undefined;

        lab = await open({ store, tracker, harness: errorReporterHarness });
        const retried = stuck === undefined ? undefined : await until(async () => {
          const row = (await lab!.rows()).find((r) => r.id === stuck.id);
          return row !== undefined && ["previewing", "filed"].includes(row.status) ? row : undefined;
        }, DRAFT_MS);
        const retriedAsk = retried === undefined ? undefined : (await lab.reportAsks()).find((a) => a.sessionId === retried.sessionId);
        const count = (await lab.rows()).find((r) => r.id === leg2Row?.id)?.count;
        say(`leg 6: after the restart the report is ${retried?.status ?? "not retried"}${retriedAsk === undefined ? "" : ", in Inbox"}; leg 2's count is ${count}`);
        if (retried === undefined || retriedAsk === undefined) fail("6", "after a restart the report is retried and reaches Inbox: it did not");
        if (count !== 11) fail("6", `leg 2's count is still 11: ${count}`);
        if (retried !== undefined && retriedAsk !== undefined && count === 11) evidence.push("leg 6: the reporter's own failure left its report owed, unreported; a restart retried it into Inbox; the count stayed 11");
        await lab.lab.errorReporter!.idle();
      }

      // ---- leg 5: no secret anywhere ------------------------------------------
      if (runs("5")) {
        const rows = await lab.rows();
        const runtime = await lab.lab.state.getRuntime();
        const reportSessions = rows.map((r) => r.sessionId).filter((id): id is string => id !== undefined);
        const records = reportSessions.length === 0 ? [] : await runtime.stores.request.list({ sessionId: reportSessions, withItems: true } as never);
        const found = [
          ...secretsIn(rows, SECRETS).map((s) => `${s} in a report row`),
          ...secretsIn(records, SECRETS).map((s) => `${s} in a report session's record`),
          ...secretsIn(tracker.calls, SECRETS).map((s) => `${s} in a tracker call`),
        ];
        say(`leg 5: ${rows.length} report(s), ${records.length} report-session record(s), ${tracker.calls.length} tracker call(s); secrets found: ${found.join(", ") || "none"}`);
        for (const where of found) fail("5", `no secret in a report: ${where}`);
        if (found.length === 0) evidence.push("leg 5: no secret in any report, report session or tracker call");
      }
      await lab?.close();
      lab = undefined;
    }

    // ---- leg C: the chief of staff, in a fresh Lab ------------------------------
    if (runs("C")) {
      lab = await open({ store: "memory", tracker: undefined, harness: draftingStub });
      const inInbox = async (row: ReportRow | undefined) =>
        row !== undefined && (await lab!.reportAsks()).some((a) => a.sessionId === row.sessionId);

      const crashed = await lab.tellChief("What's the status of the Sandbox project?");
      say(`leg C: the chief of staff's turn ${crashed.failed ? "failed" : "completed"} (request ${crashed.requestId}${crashed.error === undefined ? "" : `: ${crashed.error}`})`);
      if (crashed.failed) fail("C", "the chief of staff answers its own crash: the request failed");
      const own = await until(async () => {
        const row = (await lab!.rows()).find((r) => r.occurrences.some((o) => o.requestId === crashed.requestId));
        return row !== undefined && row.status === "previewing" ? row : undefined;
      }, 120_000);
      say(`leg C: ${own === undefined ? "no report" : `report ${own.id}, ${own.status}`} for the chief of staff's crash`);
      if (!(await inInbox(own))) fail("C", "the chief of staff's own crash reaches Inbox: it did not");
      else evidence.push("leg C: the chief of staff's crash, answered with \"Nobody took this message\", reached Inbox as a report");

      await lab.addDelegate(POST_TAKER);
      const posted = await lab.tellChief(`post to ${POST_TAKER}: Summarize the Sandbox notes [post-bug]`);
      if (posted.failed) fail("C", `the post was handed on: ${posted.error}`);
      const delegated = await until(async () => {
        const row = (await lab!.rows()).find((r) => r.source === "task" && r.task?.assignee === POST_TAKER);
        return row !== undefined && row.status === "previewing" ? row : undefined;
      }, 120_000);
      say(`leg C: ${delegated === undefined ? "no report" : `report ${delegated.id}, ${delegated.status}: ${delegated.task?.error}`} for ${POST_TAKER}'s failed post`);
      if (!(await inInbox(delegated))) fail("C", "the delegate's failed post reaches Inbox: it did not");
      else evidence.push(`leg C: ${POST_TAKER}'s failed post reached Inbox as a report`);
      await lab.close();
      lab = undefined;
    }

    // ---- leg 3: a burst, in a fresh Lab ----------------------------------------
    if (runs("3")) {
      lab = await open({ store: "memory", tracker: undefined, harness: draftingStub });
      for (const word of BURST_WORDS) await lab.tellProject("sandbox", `burst: ${word}`);
      await sleep(3_000);
      const rows = await lab.rows();
      const reports = rows.filter((r) => r.kind === "report");
      const storms = rows.filter((r) => r.kind === "storm");
      const placed = new Map<string, number>();
      for (const word of BURST_WORDS) {
        const own = reports.filter((r) => r.parts.message.toLowerCase().includes(` ${word} `)).length;
        const listed = storms.flatMap((s) => s.storm?.entries ?? []).filter((e) => e.message.toLowerCase().includes(` ${word} `)).length;
        placed.set(word, own + listed);
      }
      say(`leg 3: ${reports.length} report(s), ${storms.length} storm report(s) listing ${storms.flatMap((s) => s.storm?.entries ?? []).length}`);
      if (reports.length < 1 || reports.length > 5) fail("3", `at most 5 reports: ${reports.length}`);
      if (storms.length !== 1) fail("3", `one storm report: ${storms.length}`);
      const misplaced = [...placed].filter(([, n]) => n !== 1).map(([w, n]) => `${w}×${n}`);
      if (misplaced.length > 0) fail("3", `each failure in exactly one report: ${misplaced.join(", ")}`);
      if (reports.length >= 1 && reports.length <= 5 && storms.length === 1 && misplaced.length === 0) {
        evidence.push(`leg 3: 30 failures → ${reports.length} reports + 1 storm report, each failure in exactly one`);
      }
    }
  } finally {
    await lab?.close().catch(() => {});
    await tracker.close();
  }
  if (tracker.refused() > 0) say(`the tracker turned away ${tracker.refused()} request(s) with no or a wrong key`);
  return { failures, evidence: evidence.join("; ") };
});
