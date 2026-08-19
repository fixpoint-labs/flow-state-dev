/**
 * Goal check — harness-workstream › it mirrors a coding run as workstream items.
 *
 * Dispatches a REAL Claude Code run into a workstream (a child session) through
 * the real task board, then reconstructs what the run did by reading ONLY FSD
 * state over the real HTTP routes: the workstream listing, and that workstream's
 * own request history with `include_items=true`. The harness transcript is never
 * opened, the working tree is never read, and git is never consulted.
 *
 * ## What is real here, and what the goal would prove nothing without
 *
 * - **A real `createFlowState` runtime**, not a bare `runAction`. The detached
 *   start operation is installed by `createFlowState`; a script that only calls
 *   `runAction` has no request host and the first `startDetached` throws by name.
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
 * workstream topic, the file the run is asked to write, and the marker string it
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
 * the workstream request was settled, and a future reader should not read one
 * into it.
 *
 * Run: pnpm tsx goals/harness-workstream/mirrors-a-coding-run-as-workstream-items/run.mts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { defineTaskCollection, type TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

interface Fixture {
  topic: string;
  outputFileName: string;
  marker: string;
  secondLine: string;
}

/** Stable board id — hashed into the workstream's session id. */
const BOARD_ID = "harness-coding";
/** The flow's `kind`, which is what the HTTP routes address it by. */
const FLOW_KIND = "harness-coding";
/** The agent block's default name — how its items are attributed. */
const AGENT_BLOCK_NAME = "claude-code-agent";
/** The one assignee this board routes to. */
const ASSIGNEE = "implement";
const USER_ID = "goal-user";
const PARENT_SESSION_ID = `sess_lab133_${Date.now()}`;

/** How long to wait for the workstream to stop being `active`. */
const RUN_TIMEOUT_MS = Number(process.env.GOAL_RUN_TIMEOUT_MS ?? 300_000);
const POLL_INTERVAL_MS = 2_000;

/** One background job as the workstream listing route reports it. */
type WorkstreamRow = {
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
  const workDir = mkdtempSync(join(tmpdir(), "lab133-"));
  const dbFile = join(workDir, "goal.sqlite");
  const targetPath = join(workDir, fixture.outputFileName);

  const { createFlowState } = await import("@flow-state-dev/engine");
  const { sqliteStores } = await import("@flow-state-dev/store-sqlite");
  const { serve } = await import("@flow-state-dev/node");

  /** The durable ledger the conversation and its workstream share. */
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
        // Bounded on purpose: a small, deterministic job, not an open-ended one.
        allowedTools: ["Write", "Read"],
        // `acceptEdits`, NOT `bypassPermissions`: the latter maps to
        // `--dangerously-skip-permissions`, which the CLI refuses outright when
        // the process has root privileges — and the refusal arrives as a bare
        // `process exited with code 1`, which reads like a broken dispatch.
        permissionMode: "acceptEdits",
        maxTurns: 8,
        systemPrompt:
          "You are a coding agent doing one small file-writing job. Do it, then say what you did in one sentence.",
      }),
    ) as unknown as TaskWorker;

  const board = taskBoard({
    name: BOARD_ID,
    boardId: BOARD_ID,
    collection: codingTasks,
    // No `maxAttempts` on the task and no `onError` override — the board's
    // defaults. See the header: settlement is FIX-1182's, not this goal's.
    workers: {
      [ASSIGNEE]: { worker: codingRun, dispatch: { mode: "detached" } },
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
        // workstream with — held out, so the listing assertion below is reading
        // the fixture's value round-tripped through the real dispatch.
        metadata: { topic: fixture.topic },
      });
    },
  });

  const codingFlow = defineFlow({
    kind: FLOW_KIND,
    actions: {
      dispatch: {
        block: sequencer({
          name: "harness-coding-dispatch",
          inputSchema: z.object({ goal: z.string() }),
          outputSchema: z.unknown(),
        })
          .tap(fileCodingTask)
          // The drain claims the row, hands it to a workstream, and returns with
          // the row still open. The originating request does NOT wait for the
          // run — which is the point.
          .step(board.drain),
      },
    },
  })({ id: "default" });

  function neverResolvesAModel(): never {
    throw new Error(
      "harness-workstream goal: this flow declares no generator actions — the coding run " +
        "goes through the Claude Code Agent SDK, which resolves its own model.",
    );
  }

  const flowstate = createFlowState({
    flows: { [FLOW_KIND]: codingFlow },
    modelResolver: Object.assign(neverResolvesAModel, {
      resolveId: neverResolvesAModel,
    }) as never,
    stores: { prod: { primary: sqliteStores({ filename: dbFile }) } },
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
   * the poll below would read that as "no workstream yet", and the goal would
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

  try {
    // The job. Everything an assertion keys on comes from the fixture.
    const goalText =
      `Create the file at the absolute path ${targetPath}. It must contain exactly two lines: ` +
      `the first line ${fixture.marker}, and the second line "${fixture.secondLine}". ` +
      `Then reply in one sentence naming the file you wrote.`;

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
      return {
        failures: [`dispatch failed with ${dispatchRes.status}: ${await dispatchRes.text()}`],
        evidence: "",
      };
    }

    // ── Hop 1: which background jobs did this conversation start? ────────────
    // Poll until the workstream exists AND has stopped being `active`. The
    // originating request cannot observe its own hand-off settling — the board
    // view it hydrated never sees the workstream's write — so polling from the
    // outside is the only shape that works.
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let workstream: WorkstreamRow | undefined;
    while (Date.now() < deadline) {
      const body = await getJson(`/sessions/${PARENT_SESSION_ID}/workstreams`);
      // The envelope: rows are under `workstreams`, not at the top level.
      const rows = (body?.workstreams ?? []) as WorkstreamRow[];
      workstream = rows[0];
      if (workstream !== undefined && workstream.status !== "active") break;
      await sleep(POLL_INTERVAL_MS);
    }

    if (workstream === undefined) {
      return {
        failures: [
          `no workstream was started for session ${PARENT_SESSION_ID} within ` +
            `${RUN_TIMEOUT_MS}ms — the coding run never got its own place in the system`,
        ],
        evidence: "",
      };
    }
    if (workstream.status === "active") {
      failures.push(
        `the workstream was still active after ${RUN_TIMEOUT_MS}ms; the assertions below ` +
          `read a run that had not finished`,
      );
    }
    // A workstream is a CHILD SESSION, not the conversation that asked.
    if (workstream.id === PARENT_SESSION_ID) {
      failures.push("the workstream is the originating session, not a child session");
    }
    if (workstream.parentSessionId !== PARENT_SESSION_ID) {
      failures.push(
        `the workstream reports parent "${workstream.parentSessionId}", expected "${PARENT_SESSION_ID}"`,
      );
    }
    // Round-tripped through the real dispatch, so this is the held-out value
    // coming back rather than a constant.
    if (workstream.topic !== fixture.topic) {
      failures.push(
        `expected the workstream to carry the held-out topic "${fixture.topic}", got "${workstream.topic}"`,
      );
    }

    // ── Hop 2: what happened inside it? ──────────────────────────────────────
    // `include_items=true` is required. Without it this returns summaries and
    // the run cannot be reconstructed — and on an adapter that honours the flag
    // (this one), its absence is observable rather than advisory.
    const withItems = (await getJson(
      `/sessions/${workstream.id}/requests?include_items=true`,
    )) as { requests?: StoredRequest[] };
    const withoutItems = (await getJson(`/sessions/${workstream.id}/requests`)) as {
      requests?: StoredRequest[];
    };

    const requests = withItems?.requests ?? [];
    if (requests.length === 0) {
      return {
        failures: [...failures, `the workstream ${workstream.id} has no request history at all`],
        evidence: "",
      };
    }

    const items = requests.flatMap((r) => r.items ?? []);
    if (items.length === 0) {
      failures.push(
        "the workstream's item stream is empty — a run that completes with nothing " +
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
    // monotonicity would report a false failure the moment a workstream has a
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
          `file name "${fixture.outputFileName}" appears nowhere in the workstream's items, ` +
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
          "landed in the conversation that asked instead of staying in its workstream",
      );
    }

    return {
      failures,
      evidence:
        `a real Claude Code run was dispatched into workstream ${workstream.id} (child of ` +
        `${PARENT_SESSION_ID}, topic "${workstream.topic}", status "${workstream.status}"); ` +
        `its request history returned ${items.length} items with include_items=true and ` +
        `${bareItems.length} without, of which ${messages.length} top-level messages and ` +
        `${tools.length} top-level tool_outputs, non-decreasing on ${orderSpan}, naming the ` +
        `held-out file "${fixture.outputFileName}"; the originating request's own stream ` +
        `carried none of the run's mirrored items. Store adapter: @flow-state-dev/store-sqlite. ` +
        `Settlement not asserted — board defaults, no retry allowance, lost runs written off ` +
        `(FIX-1182).`,
    };
  } finally {
    await host.close();
    rmSync(workDir, { recursive: true, force: true });
  }
});
