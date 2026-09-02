/**
 * Goal check — harness-child-session › it mirrors a coding run as child session items,
 * and records what that run DID.
 *
 * Dispatches REAL Claude Code runs into a child session through
 * the real task board, then reconstructs what the runs did by reading ONLY FSD
 * state over the real HTTP routes: the child session listing, that child session's own
 * request history with `include_items=true`, and the two records the runs wrote
 * as they worked (`observed-file-ops` / `observed-plan`, plus `observed-gaps`)
 * over the list-collection-state route. The harness transcript is never opened,
 * the working tree is never read, the files the runs wrote are never opened, and
 * git is never consulted.
 *
 * ## Reading the two records, and the three ways that read goes blind
 *
 * - **A row's payload is on `clientData`, not `state`.** The route builds each
 *   row as `{ topic, storageKey, clientData }`. Reading `state` returns
 *   `undefined` after a perfectly valid 200 — the same shape as the `seq` bug
 *   below, where a check reads a field the payload never carries and reports
 *   "no data" instead of failing.
 * - **`topicPrefix` is matched against the STORAGE key.** Records are namespaced
 *   per run and the child session is reused across runs, so an unscoped read
 *   returns the first page of the collection's whole sorted key space — which
 *   can be another run's rows entirely. And `nextCursor` has to be followed:
 *   the default page is 50.
 * - **403 is the default.** A collection is invisible to clients unless it
 *   declares `client.state.read`, so these reads being 200 is under test rather
 *   than assumed — `getJson` throws on a non-2xx rather than reading it as
 *   "no rows".
 *
 * ## What is real here, and what the goal would prove nothing without
 *
 * - **A real `createFlowState` runtime**, not a bare `runAction`. The dispatch
 *   operation is installed by `createFlowState`; a script that only calls
 *   `runAction` has no dispatch seam and the first hand-off throws by name.
 * - **A real `serve()` host**, so the readback goes through the shipped routes
 *   and their real response envelopes rather than a store read dressed up as one.
 * - **`@flow-state-dev/store-sqlite`, named deliberately.** `withItems` is
 *   documented as advisory and the in-memory store IGNORES it — it returns items
 *   whether or not the flag is set, so a readback assertion that passes there
 *   proves nothing about the route. SQLite keeps items in a separate table and
 *   does branch on the flag, which is the only reason `include_items=true` is
 *   under test at all.
 * - **A real Claude Code run**, through the real Agent SDK. The one thing the
 *   run is asked to do is small and deterministic; whether it did it *well* is
 *   LAB-135's question, not this goal's.
 *
 * ## Held out
 *
 * Everything the assertions key on comes from `fixtures/input.json` — the
 * child session topic, the file the run is asked to write, and the marker string it
 * is asked to echo. Nothing is asserted against a literal, so swapping the
 * fixture for another valid one must still pass a correct implementation.
 *
 * ## Settlement is NOT under test, deliberately
 *
 * This board takes the task board's DEFAULTS: no retry allowance
 * (`maxAttempts` unset, so `shouldRetryOnFail` returns false) and no `onError`
 * override. Every throw therefore settles the row terminally on the first
 * attempt — which is what keeps a coding agent from ever re-running over its own
 * commits, the one genuine harm in this area.
 *
 * The stated cost, not hidden: a run we *lost* — a shutdown, an aborted request,
 * a lapsed lease — is **written off** rather than staying recoverable. At
 * prototype posture a lost run is re-dispatched by hand. Designing the three
 * endings properly is FIX-1182; this goal asserts nothing about how the row or
 * the child session request was settled, and a future reader should not read one
 * into it.
 *
 * Run: pnpm tsx goals/harness-child-session/mirrors-a-coding-run-as-child session-items/run.mts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  claudeCodeAgent,
  OBSERVED_FILE_OPS,
  OBSERVED_GAPS,
  OBSERVED_PLAN,
} from "@flow-state-dev/claude-code/sdk";
import { defineTaskCollection, type TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

interface Fixture {
  topic: string;
  outputFileName: string;
  marker: string;
  secondLine: string;
  /** The file the SECOND run is asked to write, so the two runs are separable. */
  secondRunFileName: string;
  /** How many to-do items the job asks the run to keep. */
  planItemCount: number;
}

/** One row as the list-collection-state route returns it. */
type CollectionRow = {
  topic: string;
  storageKey: string;
  /** The PROJECTED payload. There is no `state` key on a row — see the header. */
  clientData?: Record<string, unknown>;
};

/** Stable board id — hashed into the child session's session id. */
const BOARD_ID = "harness-coding";
/** The flow's `kind`, which is what the HTTP routes address it by. */
const FLOW_KIND = "harness-coding";
/** The agent block's default name — how its items are attributed. */
const AGENT_BLOCK_NAME = "claude-code-agent";
/** The one assignee this board routes to. */
const ASSIGNEE = "implement";
const USER_ID = "goal-user";
const PARENT_SESSION_ID = `sess_harness_coding_${Date.now()}`;

/** How long to wait for the child session to stop being `active`. */
const RUN_TIMEOUT_MS = Number(process.env.GOAL_RUN_TIMEOUT_MS ?? 300_000);
const POLL_INTERVAL_MS = 2_000;

/** One background job as the child session listing route reports it. */
type ChildSessionRow = {
  id: string;
  parentSessionId: string;
  topic?: string;
  coordinate?: string;
  status?: string;
};

/**
 * The ordering field a stored item actually carries.
 *
 * Verified against a live readback payload, not assumed. The first version of
 * this goal read `seq`, which **does not exist** on a stored item — so the
 * filter that kept numeric values produced an empty array, `every` was
 * vacuously true, no failure could ever be pushed, and the goal printed "in
 * non-decreasing sequence" having measured nothing. A check that cannot see
 * what it claims to measure fails green, which is worse than not having it.
 *
 * `sequence_number` is not the field either — that one lives on SSE events, not
 * on the persisted item.
 */
const ORDER_FIELD = "itemIndex" as const;

/** The slice of a stored item the assertions read. */
type StoredItem = {
  type?: string;
  [ORDER_FIELD]?: number;
  ownedBy?: string;
  content?: Array<{ text?: string }>;
  message?: string;
  output?: unknown;
  toolCall?: { name?: string; arguments?: unknown };
  provenance?: { blockName?: string };
};

type StoredRequest = { id?: string; status?: string; items?: StoredItem[] };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Everything one stored item says the run did — prose AND activity.
 *
 * Tool calls and their results are read as well as message text, deliberately.
 * "What was this run working on" must be answerable from what the system
 * stored, and a `Write` call's arguments say it exactly, whereas the agent's
 * closing sentence says it only if the model happened to phrase it that way.
 * Keying the reconstruction on prose alone made this goal fail on a run that
 * had mirrored the job perfectly and then summarised it as "I created the file
 * with the two lines" — the check would have been grading the model's wording,
 * not the mirror.
 */
function itemText(item: StoredItem): string {
  const parts = (item.content ?? []).map((c) => c.text ?? "");
  if (typeof item.message === "string") parts.push(item.message);
  if (item.toolCall?.name !== undefined) parts.push(item.toolCall.name);
  if (item.toolCall?.arguments !== undefined) parts.push(String(item.toolCall.arguments));
  if (item.output !== undefined && item.output !== null) {
    parts.push(typeof item.output === "string" ? item.output : JSON.stringify(item.output));
  }
  return parts.join(" ");
}

await runGoal(async () => {
  const fixture = loadFixture<Fixture>(import.meta.url);
  const failures: string[] = [];

  // The run writes a real file. It goes to a throwaway directory addressed by
  // absolute path, never the repo — and the goal never reads it back, because
  // reading the working tree is exactly the anti-game this check forbids.
  const workDir = mkdtempSync(join(tmpdir(), "harness-coding-"));
  const dbFile = join(workDir, "goal.sqlite");
  const targetPath = join(workDir, fixture.outputFileName);

  const { createFlowState } = await import("@flow-state-dev/engine");
  const { sqliteStores } = await import("@flow-state-dev/store-sqlite");
  const { serve } = await import("@flow-state-dev/node");

  /**
   * The real SQLite stores, with `resourceState.getByPrefix` counted.
   *
   * A prefix read is the observable signature of a collection loading its WHOLE
   * key space. The two recorded collections are namespaced per run and the
   * child session is reused across runs, so an eagerly-prefetched collection would
   * bulk-load every previous run's rows before this run touched one of its own
   * keys — cost that grows with the child session's lifetime, on exactly the
   * long-run shape whose item persistence is already quadratic (FIX-1180).
   *
   * Counted at the STORE, not at a flag on the config: a `prefetchMode: "lazy"`
   * assertion on the declaration only proves what we wrote down. This proves
   * what the engine did with it.
   */
  const baseAdapter = sqliteStores({ filename: dbFile });
  const prefixReads: string[] = [];
  /** The resolved registry, kept so the board ledger can be read from it too. */
  let registry: any;
  let counting: any;
  const stores = {
    capabilities: baseAdapter.capabilities,
    async resolve(slots: readonly any[]) {
      if (counting === undefined) {
        registry = await baseAdapter.resolve(slots);
        // A Proxy rather than a spread: the store's methods may be bound, and a
        // spread that silently dropped `this` would fail as a broken run rather
        // than as a broken instrument.
        const inner = registry.resourceState;
        counting = {
          ...registry,
          resourceState: new Proxy(inner, {
            get(target: any, prop: string | symbol) {
              const value = Reflect.get(target, prop);
              if (typeof value !== "function") return value;
              if (prop === "getByPrefix") {
                return (scopeType: string, scopeId: string, prefix: string) => {
                  prefixReads.push(prefix);
                  return value.call(target, scopeType, scopeId, prefix);
                };
              }
              return value.bind(target);
            },
          }),
        };
      }
      return counting;
    },
    dispose() {
      baseAdapter.dispose?.();
    },
  };
  /** Prefix reads of the recorded collections, at a moment in time. */
  const recordedPrefixReads = (): number =>
    prefixReads.filter((p) =>
      [OBSERVED_FILE_OPS, OBSERVED_PLAN, OBSERVED_GAPS].some((c) => p.startsWith(`${c}/`)),
    ).length;

  /** The durable ledger the conversation and its child session share. */
  const codingTasks = defineTaskCollection({ id: BOARD_ID, scope: "user" });

  /**
   * §7e — the board's payload is not the block's input.
   *
   * The drain hands every worker a `TaskWorkerInput` (`goal`, `taskId`, …) and
   * `claudeCodeAgent` validates a required `{ prompt: string }` BEFORE its
   * prompt callback runs. Without this adapter every detached task is rejected
   * before the SDK is ever invoked — the first thing that breaks, and it breaks
   * silently early.
   */
  const taskGoalToPrompt = handler({
    name: "task-goal-to-prompt",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ prompt: z.string() }),
    execute: (input) => ({
      prompt: input.context === undefined ? input.goal : `${input.goal}\n\n${input.context}`,
    }),
  });

  /**
   * The detached worker. `detached: true` is what makes the board accept
   * it — see the option's docs in `packages/claude-code/src/sdk/agent.ts`.
   */
  const codingRun = sequencer({
    name: "coding-run",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.unknown(),
  })
    .step(taskGoalToPrompt)
    .step(
      claudeCodeAgent({
        detached: true,
        // The half LAB-134 adds: record what the run DID, not only what it said.
        recordWork: true,
        // Bounded on purpose: a small, deterministic job, not an open-ended one.
        //
        // The plan tools are named HERE and nowhere else in this file, and they
        // have to be: the job asks the run to keep a to-do list, so a list that
        // omitted them would be asking for something the run may have been
        // forbidden — and §10's INCONCLUSIVE arm would then fire on our own
        // configuration while reporting "the harness declined to plan". The
        // first real run of this check did exactly that.
        allowedTools: ["Write", "Read", "TaskCreate", "TaskUpdate"],
        // `acceptEdits`, NOT `bypassPermissions`: the latter maps to
        // `--dangerously-skip-permissions`, which the CLI refuses outright when
        // the process has root privileges — and the refusal arrives as a bare
        // `process exited with code 1`, which reads like a broken dispatch.
        permissionMode: "acceptEdits",
        // Raised from 8 once the job started asking for a to-do list: keeping a
        // two-item list and acting on it is seven tool calls before the run has
        // said anything, so the old budget made planning something a run had to
        // give up in order to finish.
        //
        // It did NOT change the outcome. Measured: eight consecutive runs
        // through this path invoked no plan tools, at 8 turns and at 16, with
        // the plan tools in `allowedTools` and without. Both of our own
        // configuration suspects are therefore ruled out, which is what makes
        // the INCONCLUSIVE arm below a statement about the harness rather than
        // about this file. Left at 16 because it matches what the job asks for.
        maxTurns: 16,
        systemPrompt:
          "You are a coding agent doing one small file-writing job. Keep a to-do list as you " +
          "work. Do the job, then say what you did in one sentence.",
      }),
    ) as unknown as TaskWorker;

  const board = taskBoard({
    name: BOARD_ID,
    boardId: BOARD_ID,
    collection: codingTasks,
    // No `maxAttempts` on the task and no `onError` override — the board's
    // defaults. See the header: settlement is FIX-1182's, not this goal's.
    workers: {
      // One child session per topic: a second job filed under the same topic
      // lands in the child the first one minted, which is what the reuse
      // assertions below read.
      [ASSIGNEE]: {
        worker: codingRun,
        session: {
          key: (task) =>
            typeof task.metadata?.topic === "string" ? task.metadata.topic : task.taskId,
        },
      },
    },
  });

  /** File this request's coding job as a durable row for the board to hand off. */
  const fileCodingTask = handler({
    name: "file-coding-task",
    inputSchema: z.object({ goal: z.string() }),
    uses: [board.capability],
    execute: async (input, ctx) => {
      await ctx.cap[BOARD_ID].addTask({
        goal: input.goal,
        assignee: ASSIGNEE,
        // `metadata.topic` is the routing identity the spawn seeds the
        // child session with — held out, so the listing assertion below is reading
        // the fixture's value round-tripped through the real dispatch.
        metadata: { topic: fixture.topic },
      });
    },
  });

  const codingFlow = defineFlow({
    kind: FLOW_KIND,
    tasks: board.tasks,
    actions: {
      dispatch: {
        block: sequencer({
          name: "harness-coding-dispatch",
          inputSchema: z.object({ goal: z.string() }),
          outputSchema: z.unknown(),
        })
          .tap(fileCodingTask)
          // The drain claims the row, hands it to a child session, and returns with
          // the row still open. The originating request does NOT wait for the
          // run — which is the point.
          .step(board.drain),
      },
    },
  })({ id: "default" });

  function neverResolvesAModel(): never {
    throw new Error(
      "harness-child-session goal: this flow declares no generator actions — the coding run " +
        "goes through the Claude Code Agent SDK, which resolves its own model.",
    );
  }

  const flowstate = createFlowState({
    flows: { [FLOW_KIND]: codingFlow },
    modelResolver: Object.assign(neverResolvesAModel, {
      resolveId: neverResolvesAModel,
    }) as never,
    stores: { prod: { primary: stores } },
    defaultProfile: "prod",
    // THE FINDING, not a workaround (§9). The default is 30 s, tuned to a
    // serverless SIGTERM grace period rather than to a coding run — an
    // in-process host must raise it past its longest expected run or accept
    // that any shutdown kills one.
    detachedDrainTimeoutMs: RUN_TIMEOUT_MS,
    logger: silentLogger,
  } as never);

  const host = await serve(flowstate as never, { port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${host.port}/api/flows`;

  /**
   * Read one route, and **throw on anything that isn't a real answer**.
   *
   * A swallowed transport error is the same defect as a blind assertion: a dead
   * host, a non-2xx, or an unparseable body would all come back as `undefined`,
   * the poll below would read that as "no child session yet", and the goal would
   * spend its whole timeout deciding the run never started. The verdict would
   * be a plausible-looking FAIL about the wrong thing — or, on a read that only
   * feeds an optional assertion, a quiet PASS. Absence has to mean absence.
   */
  const getJson = async (path: string): Promise<any> => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`);
    } catch (err) {
      throw new Error(`GET ${path} could not reach the host: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new Error(`GET ${path} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    try {
      return await res.json();
    } catch (err) {
      throw new Error(`GET ${path} returned an unparseable body: ${(err as Error).message}`);
    }
  };

  /**
   * Read one collection's rows for ONE run, scoped and paged.
   *
   * Both halves are load-bearing. `topicPrefix` is matched against the STORAGE
   * key, not the bare topic — so the value passed is the run's full namespace,
   * `<collection>/<requestId>/`. (A row's key is `<requestId>/<invocation>/…`;
   * one request runs the agent once here, so the request prefix is exactly one
   * run's rows — but the invocation segment is what keeps that true when a
   * generator calls the agent repeatedly.) Without it the route returns the first page of the
   * collection's whole sorted key space, which after enough reused-child session
   * runs can be entirely somebody else's rows. And `nextCursor` has to be
   * followed, because the default page is 50: a run that touched more files
   * than that would come back truncated and the assertion would grade a
   * fragment while reporting on the whole.
   */
  const readRun = async (
    sessionId: string,
    collection: string,
    runId: string,
  ): Promise<CollectionRow[]> => {
    const namespace = `${collection}/${runId}/`;
    const rows: CollectionRow[] = [];
    let cursor: string | undefined;
    for (;;) {
      const query = new URLSearchParams({ topicPrefix: namespace });
      if (cursor !== undefined) query.set("cursor", cursor);
      const body = (await getJson(
        `/sessions/${sessionId}/resources/${collection}?${query.toString()}`,
      )) as { items?: CollectionRow[]; nextCursor?: string };
      rows.push(...(body.items ?? []));
      if (body.nextCursor === undefined) return rows;
      cursor = body.nextCursor;
    }
  };

  // ── The graders, named — and sanity-checked before they are trusted ────────
  //
  // These are extracted rather than inlined for one reason: an assertion has to
  // be checked against the specific broken world it exists to reject, and the
  // only way to do that here is to hand it that world directly. Two of these
  // were previously inline and both passed the world they were written to
  // catch — see `selfCheck`.

  /** Every run whose file record names this file. */
  const runsNamingFile = (byRun: Map<string, CollectionRow[]>, name: string): string[] =>
    [...byRun.keys()].filter((id) =>
      (byRun.get(id) ?? []).some((r) => r.topic.endsWith(`/${name}`)),
    );

  /**
   * Is this file recorded under the run that wrote it, and ONLY that run?
   *
   * Both halves are load-bearing, and the first one is what was missing. Asking
   * only "does exactly one run own this file" passes when BOTH runs' rows land
   * in a single namespace: each filename still has exactly one owner, and the
   * other namespace is simply empty. That is precisely the collision per-run
   * keying exists to prevent, so the check that proves the keying has to name
   * the run it expects rather than count owners.
   */
  const attributionFailures = (
    byRun: Map<string, CollectionRow[]>,
    name: string,
    expectedRunId: string,
    otherRunIds: readonly string[],
  ): string[] => {
    const naming = runsNamingFile(byRun, name);
    const out: string[] = [];
    if (!naming.includes(expectedRunId)) {
      out.push(
        `the held-out file "${name}" is not in run ${expectedRunId}'s record — it was found ` +
          `under ${naming.length > 0 ? naming.join(", ") : "no run at all"}`,
      );
    }
    for (const other of otherRunIds) {
      if (naming.includes(other)) {
        out.push(
          `the held-out file "${name}" also appears under run ${other}, which did not write ` +
            `it — the records are not keyed per run`,
        );
      }
    }
    return out;
  };

  /**
   * Does this plan row show a real MOVE between two observed states?
   *
   * `previousStatus` must be a STRING, not merely different. Its schema default
   * is `null`, so `previousStatus !== status` is satisfied by a row that never
   * recorded a previous state at all — meaning a recorder that kept only a
   * final status would be graded as having preserved the transitions it threw
   * away.
   */
  const showsAMove = (data: Record<string, unknown>): boolean =>
    typeof data.status === "string" &&
    typeof data.previousStatus === "string" &&
    data.previousStatus !== data.status;

  /**
   * Hand each grader the broken world it exists to reject, before trusting it
   * on a real run.
   *
   * This is not ceremony. The plan grader below cannot be exercised by a real
   * run at all right now — it lives inside the plan half's PASS branch, and
   * every measured run has taken the INCONCLUSIVE arm — so without this its
   * correctness would rest on reading it. And the file grader's broken world
   * (two runs merged into one namespace) is not reachable through the current
   * recorder, so a real run cannot produce it either. A grader nobody has
   * watched reject anything is not a grader.
   */
  const selfCheck = (): string[] => {
    const problems: string[] = [];
    const row = (topic: string): CollectionRow => ({ topic, storageKey: topic });
    const expect = (ok: boolean, what: string): void => {
      if (!ok) problems.push(`grader self-check failed: ${what}`);
    };

    const A = "runA";
    const B = "runB";
    const correct = new Map<string, CollectionRow[]>([
      [A, [row(`${A}/i/one.txt`)]],
      [B, [row(`${B}/i/two.txt`)]],
    ]);
    expect(
      attributionFailures(correct, "one.txt", A, [B]).length === 0,
      "a correctly attributed file was rejected",
    );
    // THE broken world: both runs' rows in one namespace. Every filename still
    // has exactly one owner, which is why counting owners passed it.
    const merged = new Map<string, CollectionRow[]>([
      [A, [row(`${A}/i/one.txt`), row(`${A}/i/two.txt`)]],
      [B, []],
    ]);
    expect(
      attributionFailures(merged, "two.txt", B, [A]).length > 0,
      "two runs merged into one namespace was accepted",
    );
    expect(
      attributionFailures(new Map([[A, []], [B, []]]), "one.txt", A, [B]).length > 0,
      "a file missing from every record was accepted",
    );
    // Each half must carry its own weight. With no forbidden runs supplied,
    // only "the expected run owns this" can fire — so this is the world that
    // tells "names the run it expects" apart from the weaker "somebody owns
    // it", which the forbidden-runs half would otherwise mask.
    expect(
      attributionFailures(merged, "two.txt", B, []).length > 0,
      "a file owned by the wrong run was accepted when no other run was named",
    );
    // A file under BOTH namespaces — the older shape of the same failure.
    const duplicated = new Map<string, CollectionRow[]>([
      [A, [row(`${A}/i/one.txt`)]],
      [B, [row(`${B}/i/one.txt`)]],
    ]);
    expect(
      attributionFailures(duplicated, "one.txt", A, [B]).length > 0,
      "a file recorded under two runs was accepted",
    );

    expect(showsAMove({ status: "completed", previousStatus: "in_progress" }), "a real move");
    // THE broken world: the recorder kept only a final status.
    expect(
      !showsAMove({ status: "completed", previousStatus: null }),
      "a row with no previous status was counted as a move",
    );
    expect(
      !showsAMove({ status: "completed" }),
      "a row missing previousStatus entirely was counted as a move",
    );
    expect(
      !showsAMove({ status: "in_progress", previousStatus: "in_progress" }),
      "a row that never changed status was counted as a move",
    );
    expect(
      !showsAMove({ status: null, previousStatus: "in_progress" }),
      "a row with no current status was counted as a move",
    );
    return problems;
  };

  /** Dispatch one coding job into the board and return once it is not `active`. */
  const dispatchAndWait = async (goalText: string): Promise<ChildSessionRow[]> => {
    const dispatchRes = await fetch(`${base}/${FLOW_KIND}/actions/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { goal: goalText },
        userId: USER_ID,
        sessionId: PARENT_SESSION_ID,
      }),
    });
    if (dispatchRes.status >= 400) {
      throw new Error(`dispatch failed with ${dispatchRes.status}: ${await dispatchRes.text()}`);
    }
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let rows: ChildSessionRow[] = [];
    while (Date.now() < deadline) {
      const body = await getJson(`/sessions/${PARENT_SESSION_ID}/children`);
      // The envelope: rows are under `children`, not at the top level.
      rows = (body?.children ?? []) as ChildSessionRow[];
      if (rows.length > 0 && rows.every((r) => r.status !== "active")) break;
      await sleep(POLL_INTERVAL_MS);
    }
    return rows;
  };

  /** The job for one run. Everything an assertion keys on comes from the fixture. */
  const jobFor = (path: string): string =>
    `Create the file at the absolute path ${path}. It must contain exactly two lines: ` +
    `the first line ${fixture.marker}, and the second line "${fixture.secondLine}". ` +
    `Keep a to-do list of exactly ${fixture.planItemCount} items while you do it, and mark ` +
    `each one in progress and then completed. ` +
    `Then reply in one sentence naming the file you wrote.`;

  try {
    // Before spending two real coding runs: are the graders able to reject the
    // worlds they exist to reject? A broken instrument makes everything below
    // it meaningless, so this is a hard stop rather than a warning.
    const graderProblems = selfCheck();
    if (graderProblems.length > 0) {
      return { failures: graderProblems, evidence: "" };
    }

    // ── Hop 1: which background jobs did this conversation start? ────────────
    // Poll until the child session exists AND has stopped being `active`. The
    // originating request cannot observe its own hand-off settling — the board
    // view it hydrated never sees the child session's write — so polling from the
    // outside is the only shape that works.
    const afterFirst = await dispatchAndWait(jobFor(targetPath));
    const child: ChildSessionRow | undefined = afterFirst[0];
    // Snapshot BEFORE any readback: the read route reads by prefix too, so
    // counting after it would blame the route for the run's loading.
    const prefixReadsDuringFirstRun = recordedPrefixReads();

    if (child === undefined) {
      return {
        failures: [
          `no child session was started for session ${PARENT_SESSION_ID} within ` +
            `${RUN_TIMEOUT_MS}ms — the coding run never got its own place in the system`,
        ],
        evidence: "",
      };
    }
    if (child.status === "active") {
      failures.push(
        `the child session was still active after ${RUN_TIMEOUT_MS}ms; the assertions below ` +
          `read a run that had not finished`,
      );
    }
    // A child session is a CHILD SESSION, not the conversation that asked.
    if (child.id === PARENT_SESSION_ID) {
      failures.push("the child session is the originating session, not a child session");
    }
    if (child.parentSessionId !== PARENT_SESSION_ID) {
      failures.push(
        `the child session reports parent "${child.parentSessionId}", expected "${PARENT_SESSION_ID}"`,
      );
    }
    // Round-tripped through the real dispatch, so this is the held-out value
    // coming back rather than a constant.
    if (child.topic !== fixture.topic) {
      failures.push(
        `expected the child session to carry the held-out topic "${fixture.topic}", got "${child.topic}"`,
      );
    }

    // ── Hop 2: what happened inside it? ──────────────────────────────────────
    // `include_items=true` is required. Without it this returns summaries and
    // the run cannot be reconstructed — and on an adapter that honours the flag
    // (this one), its absence is observable rather than advisory.
    const withItems = (await getJson(
      `/sessions/${child.id}/requests?include_items=true`,
    )) as { requests?: StoredRequest[] };
    const withoutItems = (await getJson(`/sessions/${child.id}/requests`)) as {
      requests?: StoredRequest[];
    };

    const requests = withItems?.requests ?? [];
    if (requests.length === 0) {
      return {
        failures: [...failures, `the child session ${child.id} has no request history at all`],
        evidence: "",
      };
    }

    const items = requests.flatMap((r) => r.items ?? []);
    if (items.length === 0) {
      failures.push(
        "the child session's item stream is empty — a run that completes with nothing " +
          "recorded is exactly what this goal exists to rule out",
      );
    }
    // The flag is load-bearing on this adapter: the same read without it must
    // NOT carry the items. If it does, the adapter is ignoring the flag and the
    // assertion above proves nothing about the route.
    const bareItems = (withoutItems?.requests ?? []).flatMap((r) => r.items ?? []);
    if (bareItems.length > 0) {
      failures.push(
        `the request listing returned ${bareItems.length} items WITHOUT include_items=true — ` +
          "this adapter ignores the flag, so the readback assertion proves nothing about the " +
          "route (§7e-bis: use store-sqlite, not the in-memory store)",
      );
    }

    // Top-level only: a sub-agent's own items nest under a container via
    // `ownedBy`, and reconstruction filters on it.
    const topLevel = items.filter((i) => i.ownedBy === undefined || i.ownedBy === null);
    const messages = topLevel.filter((i) => i.type === "message");
    const tools = topLevel.filter((i) => i.type === "tool_output");

    if (messages.length === 0) {
      failures.push("no top-level message item — the run's own words were not mirrored");
    }
    if (tools.length === 0) {
      failures.push(
        "no top-level tool_output item — the run reported without doing anything, so " +
          "there is no activity for the stream to have carried",
      );
    }

    // IN ORDER. Two independent readings, because either alone is weak: the
    // stored ordering field must be monotonic, and the run's activity must
    // precede the report it wrote about that activity.
    //
    // Checked PER REQUEST, because `ORDER_FIELD` is an index within one
    // request's stream — flattening across requests first and then asserting
    // monotonicity would report a false failure the moment a child session has a
    // second run.
    //
    // **A missing field is a FAILURE, not a skip.** This is the half that was
    // wrong before: guarding the assertion on "did we read any numbers" meant
    // reading none satisfied it. If the ordering cannot be read the goal has no
    // evidence for the claim it is making, and no evidence is a fail.
    //
    // The hole that left, concretely: the two orderings below are meant to be
    // independent readings, and only the coarse one was ever live. A regression
    // that scrambled the intermediate items would sail through, because
    // tool-before-message survives almost any reshuffle.
    let orderSpan = "";
    for (const [n, req] of requests.entries()) {
      const reqItems = req.items ?? [];
      if (reqItems.length === 0) continue;
      const indices = reqItems.map((i) => i[ORDER_FIELD]);
      const readable = indices.filter((v): v is number => typeof v === "number");
      if (readable.length !== reqItems.length) {
        failures.push(
          `could not read the item ordering on request ${n + 1}: ${
            reqItems.length - readable.length
          } of ${reqItems.length} items carry no numeric \`${ORDER_FIELD}\`, so there is no ` +
            `evidence for the in-order claim`,
        );
        continue;
      }
      if (!readable.every((v, idx) => idx === 0 || v >= readable[idx - 1])) {
        failures.push(
          `the mirrored items are not in order on request ${n + 1}: ` +
            `${ORDER_FIELD} ${readable.join(",")}`,
        );
        continue;
      }
      orderSpan = `${ORDER_FIELD} ${readable[0]}–${readable[readable.length - 1]}`;
    }

    if (tools.length > 0 && messages.length > 0) {
      const firstTool = topLevel.indexOf(tools[0]);
      const lastMessage = topLevel.lastIndexOf(messages[messages.length - 1]);
      if (firstTool > lastMessage) {
        failures.push(
          "the run's final message is mirrored BEFORE the tool call it describes — " +
            "the stream is not in the order the run produced it",
        );
      }
    }

    // The reconstruction names the job the run was given, from state alone —
    // across the run's messages AND its tool activity (see `itemText`).
    const allText = topLevel.map(itemText).join("\n");
    if (!allText.includes(fixture.outputFileName)) {
      failures.push(
        `reading only FSD state does not say what the run was working on — the held-out ` +
          `file name "${fixture.outputFileName}" appears nowhere in the child session's items, ` +
          `neither in what the run said nor in what it did`,
      );
    }

    // ── The originating request never reads the harness transcript ───────────
    // The conversation that asked must not carry the RUN's output: that is the
    // difference between "the run has its own place in the system" and "the
    // request held open while the agent talked into it".
    //
    // Asserted on item KIND and attribution, not on the marker text. The marker
    // is part of the job the parent wrote, so it legitimately appears in the
    // parent's stream — the board publishes the filed row, goal and all. A
    // marker-substring check therefore fails on a correct implementation, which
    // it duly did: it was reading the request the conversation made and calling
    // it the answer the run gave.
    const parentBody = (await getJson(
      `/sessions/${PARENT_SESSION_ID}/requests?include_items=true`,
    )) as { requests?: StoredRequest[] };
    const parentItems = (parentBody?.requests ?? []).flatMap((r) => r.items ?? []);
    const mirroredKinds = new Set(["message", "reasoning", "tool_output", "container"]);
    const leaked = parentItems.filter(
      (i) =>
        (i.type !== undefined && mirroredKinds.has(i.type)) ||
        i.provenance?.blockName === AGENT_BLOCK_NAME,
    );
    if (leaked.length > 0) {
      failures.push(
        `the originating request's own stream carries ${leaked.length} of the run's mirrored ` +
          `items (${[...new Set(leaked.map((i) => i.type))].join(", ")}) — the coding run ` +
          "landed in the conversation that asked instead of staying in its child session",
      );
    }

    // ═══ LAB-134 — what the run DID, read from state alone ═══════════════════
    //
    // Everything above reconstructs what the run SAID. Everything below reads
    // the two records the run wrote as it worked, over the same resource route
    // any client would use. The transcript is still never opened, the working
    // tree is still never read, and the file the run wrote is still never
    // opened — a record that quotes the file it is describing proves nothing.

    /** The run ids of the runs in this child session, in the order they appear. */
    const runIdsOf = (reqs: StoredRequest[]): string[] =>
      reqs.map((r) => r.id).filter((id): id is string => typeof id === "string");

    const firstRunIds = runIdsOf(requests);
    if (firstRunIds.length !== requests.length) {
      failures.push(
        `the child session's request history does not carry an id on every request ` +
          `(${firstRunIds.length} of ${requests.length}) — the per-run namespace cannot be ` +
          `addressed, so nothing below could be read for the right run`,
      );
    }

    // ── A SECOND run into the same child session ────────────────────────────────
    // The board reuses a child session for the same board / worker / topic, so
    // without a per-run namespace the second run's file entries would merge
    // into the first's by path. This is the only assertion that can catch that,
    // and it costs a second real coding run.
    const secondTarget = join(workDir, fixture.secondRunFileName);
    const afterSecond = await dispatchAndWait(jobFor(secondTarget));
    const prefixReadsAfterSecondRun = recordedPrefixReads();

    const reusedChild = afterSecond.length === 1 && afterSecond[0]?.id === child.id;
    const secondBody = (await getJson(
      `/sessions/${child.id}/requests?include_items=true`,
    )) as { requests?: StoredRequest[] };
    const allRequests = secondBody?.requests ?? [];
    const allRunIds = runIdsOf(allRequests);

    // ── Nothing bulk-loaded the collections during either run ────────────────
    // Counted at the store, before any readback. `0` is the whole claim: a lazy
    // collection serves an upsert with a single-key read, and only `list()` or
    // `count()` — which the recorder never calls — would sweep the prefix.
    if (prefixReadsAfterSecondRun > 0) {
      failures.push(
        `the recorded collections were bulk-loaded by prefix ${prefixReadsAfterSecondRun} ` +
          `time(s) during the runs (${prefixReadsDuringFirstRun} during the first) — they are ` +
          `namespaced per run in a child session that is reused, so a full-prefix load costs every ` +
          `previous run's rows on every later run`,
      );
    }

    // ── The two records, per run, scoped and paged ───────────────────────────
    const fileRowsByRun = new Map<string, CollectionRow[]>();
    const planRowsByRun = new Map<string, CollectionRow[]>();
    const gapRowsByRun = new Map<string, CollectionRow[]>();
    for (const runId of allRunIds) {
      // A 403 here throws out of `getJson` rather than reading as "no rows":
      // the client-visibility declaration is under test, not assumed.
      fileRowsByRun.set(runId, await readRun(child.id, OBSERVED_FILE_OPS, runId));
      planRowsByRun.set(runId, await readRun(child.id, OBSERVED_PLAN, runId));
      gapRowsByRun.set(runId, await readRun(child.id, OBSERVED_GAPS, runId));
    }
    const allFileRows = [...fileRowsByRun.values()].flat();
    const allPlanRows = [...planRowsByRun.values()].flat();
    const allGapRows = [...gapRowsByRun.values()].flat();

    /** A row's payload is on `clientData` — there is no `state` key on a row. */
    const clientData = (row: CollectionRow): Record<string, unknown> => row.clientData ?? {};

    // ── The file half, graded hard ───────────────────────────────────────────
    // An empty file list is a FAIL, never an inconclusive: every run writes
    // files, so nothing legitimate produces one — and because the recorder
    // never throws, a recorder that silently skipped everything looks exactly
    // like a run that did nothing. The gap rows are what tell those apart, so
    // they are reported either way.
    if (allFileRows.length === 0) {
      failures.push(
        `the observed-file-ops record is empty across ${allRunIds.length} run(s) — the runs ` +
          `wrote files and nothing recorded them` +
          (allGapRows.length > 0
            ? `; ${allGapRows.length} gap row(s) say why: ` +
              allGapRows.map((r) => String(clientData(r).reason)).join(" | ")
            : `, and NO gap rows were written either, so the recorder was never fed at all`),
      );
    }
    // Which run wrote which file, established by WHEN each request appeared
    // rather than by the listing's order — the request that existed after the
    // first dispatch is the first run, and the one that appeared after the
    // second is the second. Ordering a listing is the route's business, not a
    // fact this goal should assume.
    const secondRunIds = allRunIds.filter((id) => !firstRunIds.includes(id));
    const expectedOwner = new Map<string, string>();
    if (firstRunIds.length === 1 && secondRunIds.length === 1) {
      expectedOwner.set(fixture.outputFileName, firstRunIds[0]);
      expectedOwner.set(fixture.secondRunFileName, secondRunIds[0]);
    } else {
      // Not a skip: without a one-to-one mapping the attribution below would be
      // comparing against a guess, and a guess that happens to hold is not
      // evidence.
      failures.push(
        `expected one request per dispatch, got ${firstRunIds.length} after the first and ` +
          `${secondRunIds.length} new after the second — which file belongs to which run ` +
          `cannot be established, so the per-run attribution below was NOT checked`,
      );
    }

    for (const name of [fixture.outputFileName, fixture.secondRunFileName]) {
      const owner = expectedOwner.get(name);
      if (owner !== undefined) {
        failures.push(
          ...attributionFailures(
            fileRowsByRun,
            name,
            owner,
            allRunIds.filter((id) => id !== owner),
          ),
        );
      }
      for (const row of allFileRows.filter((r) => r.topic.endsWith(`/${name}`))) {
        const data = clientData(row);
        // The job creates a file, so `created` is the kind it implies. `edited`
        // is exercised at unit level: forcing a real run to reach for Edit
        // rather than a second Write is not something a job can guarantee.
        if (data.lastKind !== "created") {
          failures.push(
            `the record for "${name}" says it was ${JSON.stringify(data.lastKind)}, but the ` +
              `job only asked for it to be created`,
          );
        }
        if (data.outcome !== "applied") {
          failures.push(
            `the record for "${name}" settled as ${JSON.stringify(data.outcome)} rather than ` +
              `"applied" — the run reported success and the record disagrees`,
          );
        }
      }
    }

    // ── Two runs in one child session stay separate ─────────────────────────────
    if (!reusedChild) {
      // NOT a skip. If the board did not reuse the child session, the rows landed
      // in different sessions and the per-run namespace was never the thing
      // keeping them apart — so this check measured nothing, and saying so is
      // the only honest verdict available.
      failures.push(
        `the second dispatch did not reuse the child session (${afterSecond.length} child session(s) ` +
          `for this conversation), so the per-run namespacing assertion was NOT exercised — ` +
          `this check has no evidence either way, which is not a pass`,
      );
    } else if (allRunIds.length < 2) {
      failures.push(
        `the reused child session carries ${allRunIds.length} request(s) after two dispatches, so ` +
          `the two runs could not be compared`,
      );
    } else {
      const overlap = (fileRowsByRun.get(allRunIds[0]) ?? [])
        .map((r) => r.topic)
        .filter((t) => (fileRowsByRun.get(allRunIds[1]) ?? []).some((r) => r.topic === t));
      if (overlap.length > 0) {
        failures.push(
          `two runs in one child session share ${overlap.length} file record key(s) — the records ` +
            `are not namespaced per run`,
        );
      }
    }

    // ── The plan half: PASS / FAIL / INCONCLUSIVE, and it must say which ─────
    // The two empties need opposite verdicts and are distinguishable from state
    // alone: the run's own item stream carries a tool_output for every tool it
    // called, including the plan tools. Reading our own item stream is not the
    // anti-game — the prohibition is on the harness transcript.
    const PLAN_TOOL_NAMES = new Set(["TaskCreate", "TaskUpdate"]);
    const toolItems = allRequests
      .flatMap((r) => r.items ?? [])
      .filter((i) => i.type === "tool_output");
    const planToolCalls = toolItems.filter((i) => PLAN_TOOL_NAMES.has(i.toolCall?.name ?? ""));
    /**
     * Every tool name the runs actually used.
     *
     * Reported with an INCONCLUSIVE verdict, because the arm's own failure mode
     * is a detector that cannot see the thing it is deciding about: if the
     * harness renamed its plan tools, "no plan tools fired" and "we no longer
     * recognise the plan tools" look identical from here, and only this list
     * separates them.
     */
    const toolNamesSeen = [
      ...new Set(toolItems.map((i) => i.toolCall?.name ?? "(unnamed)")),
    ].sort();

    let planArm: "PASS" | "FAIL" | "INCONCLUSIVE";
    let planWhy: string;
    if (planToolCalls.length === 0) {
      planArm = "INCONCLUSIVE";
      planWhy =
        "the runs invoked no plan tools at all, so nothing was measured about the plan half " +
        "(this is the harness declining to plan, not a recorder failure). The tools they DID " +
        `use: ${toolNamesSeen.join(", ") || "(none)"} — if a plan tool is in that list, this ` +
        "arm is wrong and the detector's name table is stale";
      failures.push(`INCONCLUSIVE — ${planWhy}`);
    } else if (allPlanRows.length === 0) {
      planArm = "FAIL";
      planWhy = `the plan tools fired ${planToolCalls.length} time(s) and NOTHING was recorded`;
      failures.push(
        `${planWhy} — our bug` +
          (allGapRows.length > 0
            ? `; ${allGapRows.length} gap row(s) say why: ` +
              allGapRows.map((r) => String(clientData(r).reason)).join(" | ")
            : `, and no gap rows explain it`),
      );
    } else {
      planArm = "PASS";
      planWhy = `${allPlanRows.length} plan row(s) from ${planToolCalls.length} plan tool call(s)`;
      // Graded at WORDING and STATUS, not on a sequence of transitions, so the
      // check goes red for our bugs rather than every time the vendor adjusts
      // a field.
      const untitled = allPlanRows.filter((r) => {
        const t = clientData(r).title;
        return typeof t !== "string" || t.length === 0;
      });
      if (untitled.length > 0) {
        failures.push(
          `${untitled.length} of ${allPlanRows.length} plan rows carry no wording — the record ` +
            `says an item existed without saying what the run thought it was`,
        );
      }
      if (!allPlanRows.some((r) => typeof clientData(r).status === "string")) {
        failures.push(
          `no plan row carries a status — the record cannot answer whether any item moved`,
        );
      }
      const moved = allPlanRows.filter((r) => showsAMove(clientData(r)));
      if (moved.length === 0) {
        failures.push(
          `no plan row shows a move between two observed statuses — the run marked items in ` +
            `progress and then completed, so a record where no row carries both a status and ` +
            `the status it held before lost the transitions it claims to keep`,
        );
      }
      // Per-run, the job asks for a fixed number of items.
      for (const runId of allRunIds) {
        const rows = planRowsByRun.get(runId) ?? [];
        const calledPlanTools = (
          allRequests.find((r) => r.id === runId)?.items ?? []
        ).some((i) => i.type === "tool_output" && PLAN_TOOL_NAMES.has(i.toolCall?.name ?? ""));
        if (calledPlanTools && rows.length !== fixture.planItemCount) {
          failures.push(
            `run ${runId} kept ${rows.length} plan item(s); the job asked for ` +
              `${fixture.planItemCount}`,
          );
        }
      }
    }

    // ── Decision 1: the run's to-dos did NOT become queued work ──────────────
    // Read through the store adapter rather than the route: the board's task
    // collection deliberately declares no client visibility, so there is no
    // route to read it over and asking for one would be widening a surface to
    // suit a test.
    const boardRows = (await registry.resourceState.getByPrefix(
      "user",
      USER_ID,
      `${BOARD_ID}/`,
    )) as Record<string, unknown>;
    const boardKeys = Object.keys(boardRows ?? {});
    if (boardKeys.length === 0) {
      // The instrument, sanity-checked against a case we know: two dispatches
      // filed two rows, so an empty read means this read is wrong, not that the
      // board is empty. Grading it as "no queued work" would be a green result
      // from a check that cannot see what it claims to measure.
      failures.push(
        `the board ledger read returned no rows at all, but two jobs were filed — this read ` +
          `cannot see the ledger, so it proves nothing about whether the runs' to-dos became ` +
          `queued work`,
      );
    } else if (boardKeys.length !== 2) {
      failures.push(
        `the board holds ${boardKeys.length} task rows after two dispatches — the runs' own ` +
          `to-do items became queued work, which is exactly what keeping the plan off the ` +
          `board exists to prevent`,
      );
    }

    // Printed on EVERY run, pass or fail. The verdict protocol prints evidence
    // only on a pass, and the arm each run took is the thing the goal's verdict
    // log has to carry — a drift toward never measuring the plan half has to be
    // visible rather than comfortable.
    const planLine = `PLAN ARM: ${planArm} — ${planWhy}`;
    console.log(
      `RECORDS: ${allFileRows.length} file row(s), ${allPlanRows.length} plan row(s), ` +
        `${allGapRows.length} gap row(s) across ${allRunIds.length} run namespace(s) in ` +
        `child session ${child.id}${reusedChild ? " (reused by both runs)" : ""}; ` +
        `${planToolCalls.length} plan tool call(s) in the item stream; ` +
        `${prefixReadsAfterSecondRun} full-prefix load(s) of the recorded collections during ` +
        `the runs; board ledger holds ${boardKeys.length} task row(s)`,
    );
    for (const row of allFileRows) {
      console.log(`  file  ${row.topic} -> ${JSON.stringify(clientData(row))}`);
    }
    for (const row of allPlanRows) {
      console.log(`  plan  ${row.topic} -> ${JSON.stringify(clientData(row))}`);
    }
    for (const row of allGapRows) {
      console.log(`  gap   ${row.topic} -> ${JSON.stringify(clientData(row))}`);
    }
    console.log(planLine);

    return {
      failures,
      evidence:
        `a real Claude Code run was dispatched into child session ${child.id} (child of ` +
        `${PARENT_SESSION_ID}, topic "${child.topic}", status "${child.status}"); ` +
        `its request history returned ${items.length} items with include_items=true and ` +
        `${bareItems.length} without, of which ${messages.length} top-level messages and ` +
        `${tools.length} top-level tool_outputs, non-decreasing on ${orderSpan}, naming the ` +
        `held-out file "${fixture.outputFileName}"; the originating request's own stream ` +
        `carried none of the run's mirrored items. ` +
        `Then, over the resource route: ${allFileRows.length} file row(s) and ` +
        `${allPlanRows.length} plan row(s) across ${allRunIds.length} run namespace(s), read ` +
        `with topicPrefix + cursor paging, 200 not 403, each row's payload on clientData; ` +
        `${allGapRows.length} gap row(s); ${prefixReadsAfterSecondRun} full-prefix load(s) of ` +
        `the recorded collections during the runs (counted at the store, before any readback — ` +
        `the read route itself reads by prefix); the board ledger holds ${boardKeys.length} task ` +
        `row(s) — the runs' to-dos did not become queued work. ${planLine}. ` +
        `Store adapter: @flow-state-dev/store-sqlite. ` +
        `Settlement not asserted — board defaults, no retry allowance, lost runs written off ` +
        `(FIX-1182).`,
    };
  } finally {
    await host.close();
    rmSync(workDir, { recursive: true, force: true });
  }
});
