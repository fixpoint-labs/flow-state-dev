/**
 * views › screens read sessions live (FIX-2725).
 *
 * One `serve()` host on a bound port, built by the conversation-board test
 * host (workforce's roster flow, the coordinator flow and its workers, a
 * verified `x-user` header) plus the harness kit's `harnesses` flow with its
 * coding board view. A real client (Node's `fetch` and `WebSocket`) watches
 * three views with its poll off, and its fetcher counts every call of each:
 *
 *   - the worker sessions view (`workerSessions`, user scope) for Lead;
 *   - the session turns view (`sessionTurns`, user scope) for one conversation;
 *   - the coding board view (`codingBoard`, user scope, on `harnesses`) for it.
 *
 *   a  — after each step, each answer equals a fresh read of the store, within 1 s.
 *   b  — during one reply of 40 stored chunks, each view runs at most 3 times.
 *   c  — bob's calls with alice's session, alice's session in a second org,
 *        and alice's own write session answer nothing and name no topic of it.
 *   d  — no view run starts a request.
 *
 * Controls (run this file again with a patch applied as it loads):
 *   GOAL_CONTROL=unrecorded-session-reads  `list` records nothing: must FAIL a.
 *   GOAL_CONTROL=turns-deaf-to-request     turns hear no `request`: must FAIL b.
 *   GOAL_CONTROL=admit-by-input            the reads skip the owner rule: must FAIL c.
 *   GOAL_CONTROL=user-only-admission       the reads check the user id alone: must FAIL c.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { defineFlow } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createClient, viewRef, type Client } from "@flow-state-dev/client";
import { watchView } from "@flow-state-dev/client/internal";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, type ModulePatch } from "../../lib/index.mts";
import { bootBoardHost } from "../../../packages/workforce/test/conversation-board-harness.ts";
import { codingBoardView } from "../../../packages/harness-manager/src/kit/coding-board.ts";
import { TURN_ACTIONS } from "../../../packages/workforce/src/workers/turn-actions.ts";
import { createWorkforceClient } from "../../../packages/workforce/src/workers/client.ts";
import { filingSessionIdOf } from "../../../packages/workforce/src/conversation-board/filing-session.ts";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import { sleep } from "../../lib/time.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("views-screens-read-sessions");
const BOUND_MS = 1_000;
const SESSIONS = "packages/engine/src/context/request-sessions.ts";

const PATCHES: Record<string, ModulePatch[]> = {
  "unrecorded-session-reads": [
    // `list` itself: the read that answers nothing is heard on the same topic, and stays.
    // Turns' recording is `turns-deaf-to-request`'s to break, so each control fails its own signal.
    { module: SESSIONS, from: String.raw`(Promise<SessionList> \{\n\s*//[^\n]*\n\s*)inputs\.observe\?\.list\(\);`, to: "$1" }
  ],
  // The turns view stops hearing a request's status (it keeps a session's birth and delete):
  // the reply never shows as it runs and ends.
  "turns-deaf-to-request": [{ module: "packages/engine/src/context/view-reads.ts", from: String.raw`turns: \["request", "state"\],`, to: 'turns: ["state"],' }],
  "admit-by-input": [{ module: SESSIONS, from: String.raw`const own = principalSession\(record, identity\);`, to: "const own = record;" }],
  "user-only-admission": [
    {
      module: SESSIONS,
      from: String.raw`const own = principalSession\(record, identity\);\n(\s*)if \(own === undefined \|\| inputs\.admit === undefined\) return own;`,
      to: "const own = record !== undefined && record.userId === identity.userId ? record : undefined;\n$1return own;"
    },
    { module: SESSIONS, from: String.raw`if \(isWriteRecord\(candidate\)\) continue;`, to: "" }
  ]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

type Call = { at: number; url: string };

/** `userId`'s client against `base`, counting every view call it makes. */
function clientOf(base: string, userId: string): { client: Client; views: Call[] } {
  const views: Call[] = [];
  const client = createClient({
    userId,
    baseUrl: base,
    fetcher: (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/views/")) views.push({ at: Date.now(), url });
      return fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), "x-user": userId } });
    }
  });
  return { client, views };
}

/** Wait, up to `withinMs`, for `check` to hold; the ms it took, or `undefined`. */
async function within(check: () => Promise<boolean>, from: number, withinMs = 3_000): Promise<number | undefined> {
  for (;;) {
    if (await check()) return Date.now() - from;
    if (Date.now() - from > withinMs) return undefined;
    await sleep(10);
  }
}

async function quiet(lists: Array<{ at: number }[]>, quietMs = 800): Promise<void> {
  for (;;) {
    const last = Math.max(0, ...lists.map((list) => list[list.length - 1]?.at ?? 0));
    const wait = last + quietMs - Date.now();
    if (wait <= 0) return;
    await sleep(wait);
  }
}

const WORKER_SESSIONS = viewRef("workforce-roster", "workerSessions");
const SESSION_TURNS = viewRef("workforce-roster", "sessionTurns");
const CODING_BOARD = viewRef("harnesses", "codingBoard");

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const host = bootBoardHost({
    plainFlowsOf: (installation) => ({
      harnesses: defineFlow({ kind: "harnesses", views: { codingBoard: codingBoardView(installation) } } as never)({ id: "harnesses" } as never) as unknown as FlowInstance
    })
  });
  let handle: ServeHandle | undefined;
  const stops: Array<() => void> = [];
  try {
    handle = await serve((await host.router()) as never, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200 });
    const base = `http://127.0.0.1:${handle.port}`;
    const stores = (await host.state.getRuntime()).stores;
    const alice = clientOf(base, "alice");
    const writer = clientOf(base, "alice").client;
    const bob = clientOf(base, "bob");

    // ---------------------------------------------------------------- fresh reads of the store
    const storeSessions = async () =>
      (await stores.session.list({ flowKind: "coordinator", userId: "alice", tenantId: undefined }))
        .filter((s) => (s.state as Record<string, unknown>).workerId === "lead" && Object.keys(s.state).every((key) => !["filingSessionId", "workstreamId", "projectId", "taskId"].includes(key)))
        .map((s) => s.id)
        .sort();
    const storeRunning = async () =>
      new Set((await stores.request.list({ userId: "alice", status: "in_progress" })).filter((r) => TURN_ACTIONS.includes(r.actionName)).map((r) => r.sessionId));
    const storeTurns = async (sessionId: string) =>
      (await stores.request.list({ sessionId, userId: "alice" })).filter((r) => TURN_ACTIONS.includes(r.actionName)).map((r) => `${r.id}:${r.status}`).sort();
    const storeBoard = async (sessionId: string) => {
      const record = await stores.session.get(sessionId);
      if (record?.lineageId == null) return [];
      const partition = encodeUserSegment(await filingSessionIdOf({ identity: { id: sessionId }, lineageId: record.lineageId }));
      return (await host.rows("alice")).filter((r) => r.partition === partition).map((r) => `${r.id}:${r.status}`).sort();
    };

    // ---------------------------------------------------------------- the three watches
    const conversation = await host.conversation("alice", "lead");
    type Seen<T> = Array<{ at: number; value: T }>;
    const sessions: Seen<Array<{ id: string; isDefault: boolean; running: boolean }>> = [];
    const turns: Seen<Array<{ id: string; status: string }>> = [];
    const board: Seen<Array<{ id: string; status: string }>> = [];
    const watch = <T,>(ref: ReturnType<typeof viewRef>, input: unknown, into: Seen<T>) =>
      stops.push(watchView<T>(alice.client, ref as never, input, { onValue: (value) => into.push({ at: Date.now(), value }) }, { pollIntervalMs: null }));
    watch(WORKER_SESSIONS, { worker: "lead" }, sessions);
    watch(SESSION_TURNS, { sessionId: conversation }, turns);
    watch(CODING_BOARD, { sessionId: conversation }, board);
    await sleep(1_500);
    await quiet([alice.views]);
    if (sessions.length === 0 || turns.length === 0 || board.length === 0) failures.push("a:equals-store: a watch never answered at start");

    const last = <T,>(seen: Seen<T>) => seen[seen.length - 1]?.value;
    const equalsStore = async (step: string, from: number) => {
      const checks: Array<[string, () => Promise<boolean>]> = [
        ["sessions", async () => JSON.stringify((last(sessions) ?? []).map((s) => s.id).sort()) === JSON.stringify(await storeSessions())],
        [
          "running",
          async () => {
            const running = await storeRunning();
            return (last(sessions) ?? []).every((s) => s.running === running.has(s.id));
          }
        ],
        ["turns", async () => JSON.stringify((last(turns) ?? []).map((t) => `${t.id}:${t.status}`).sort()) === JSON.stringify(await storeTurns(conversation))],
        ["board", async () => JSON.stringify((last(board) ?? []).map((t) => `${t.id}:${t.status}`).sort()) === JSON.stringify(await storeBoard(conversation))]
      ];
      const times: number[] = [];
      // Each screen on its own clock from the step's start, so one late screen doesn't delay another's.
      const measured = await Promise.all(checks.map(async ([what, check]) => [what, await within(check, from)] as const));
      for (const [what, ms] of measured) {
        if (ms === undefined) failures.push(`a:equals-store: after ${step}, the ${what} screen never equalled the store within 3 s`);
        else if (ms >= BOUND_MS) failures.push(`a:equals-store: after ${step}, the ${what} screen equalled the store ${ms} ms after (bound ${BOUND_MS})`);
        else times.push(ms);
      }
      tell.over(`a:equals-store · ${step}`, times);
      if (times.length === checks.length) evidence.push(`${step} ${Math.max(...times)} ms`);
    };

    // ---------------------------------------------------------------- a
    {
      // A second session opened from another tab.
      let from = Date.now();
      const second = await host.create("alice", "coordinator", { state: { workerId: "lead" } });
      if (second.status !== 201) failures.push(`setup: a second session failed (${second.status})`);
      await equalsStore("a second session opened in another tab", from);
      // A first task filed on an empty board.
      from = Date.now();
      await (await writer.flow("coordinator").send("createTask_tasks", { goal: "Audit licenses", assignee: "eng.tasker", held: true }, { sessionId: conversation })).wait();
      await equalsStore("a first task filed on an empty board", from);
      // The watched conversation deleted, then recreated under its id: the board shows the new one's (none).
      from = Date.now();
      await writer.sessions.delete(conversation);
      await host.conversation("alice", "lead", conversation);
      await equalsStore("the conversation deleted and recreated under its id", from);
      if ((last(board) ?? []).length !== 0) failures.push("a:equals-store: the board still shows the deleted conversation's tasks");
    }

    // ---------------------------------------------------------------- b
    {
      // One reply: a turn in progress whose `chunks` items land one batch at a time, 25 ms apart.
      // Answers the view calls each screen made over it.
      const reply = async (chunks: number): Promise<Record<"sessions" | "turns" | "board", number>> => {
        await quiet([alice.views]);
        const callsBefore = alice.views.length;
        const requestId = `req_reply_${chunks}_${RUN_STAMP}`;
        const now = Date.now();
        const session = (await stores.session.get(conversation))!;
        await stores.request.set(
          requestId,
          { id: requestId, flowKind: session.flowKind, flowId: session.flowId, actionName: "respond", userId: "alice", orgId: session.orgId ?? undefined, sessionId: conversation, source: "http", status: "in_progress", startedAtMs: now, state: {}, version: 0, createdAt: now, updatedAt: now } as never,
          "absent" as never
        );
        // The bound alone passes a view that never woke: the reply must also show, running, then done.
        const shownRunning = await within(
          async () => (last(sessions) ?? []).some((s) => s.id === conversation && s.running) && (last(turns) ?? []).some((t) => t.id === requestId && t.status === "in_progress"),
          Date.now()
        );
        if (shownRunning === undefined) failures.push(`b:quiet: the ${chunks}-chunk reply never showed as a running turn of a running session within 3 s`);
        for (let chunk = 0; chunk < chunks; chunk += 1) {
          await (stores.request as unknown as { persistItems(id: string, items: unknown[]): Promise<unknown> }).persistItems(requestId, [
            { id: `${requestId}_${chunk}`, type: "message", role: "assistant", status: "in_progress", requestId, itemIndex: chunk, ts: Date.now(), content: [{ type: "output_text", text: `chunk ${chunk} ` }] }
          ]);
          await sleep(25);
        }
        const ran = (await stores.request.get(requestId))!;
        await stores.request.set(requestId, { ...ran, status: "completed", completedAtMs: Date.now() } as never, ran.version as never);
        const shownDone = await within(
          async () => (last(turns) ?? []).some((t) => t.id === requestId && t.status === "completed") && (last(sessions) ?? []).some((s) => s.id === conversation && !s.running),
          Date.now()
        );
        if (shownDone === undefined) failures.push(`b:quiet: the ${chunks}-chunk reply's turn never showed completed, and its session no longer running, within 3 s`);
        else evidence.push(`b: the ${chunks}-chunk reply showed running ${shownRunning} ms after it started and completed ${shownDone} ms after it ended`);
        await quiet([alice.views]);
        const calls = alice.views.slice(callsBefore);
        return {
          sessions: calls.filter((c) => c.url.includes("workerSessions")).length,
          turns: calls.filter((c) => c.url.includes("sessionTurns")).length,
          board: calls.filter((c) => c.url.includes("codingBoard")).length
        };
      };
      // Each of the reply's two status writes (start, end) is heard by the sessions view twice: on the
      // user topic, which its list hears, and on the session's `request`, which its running read hears.
      // The turns view and the board hear one topic each. None hears a chunk, so a longer reply runs
      // them no more often: the counts at 40 and 120 chunks must be equal.
      const BOUND = { sessions: 4, turns: 3, board: 3 } as const;
      const short = await reply(40);
      const long = await reply(120);
      tell.over("b:quiet · view calls during a 40-chunk reply", Object.values(short));
      tell.over("b:quiet · view calls during a 120-chunk reply", Object.values(long));
      for (const [counts, chunks] of [[short, 40], [long, 120]] as const) {
        for (const view of ["sessions", "turns", "board"] as const) {
          if (counts[view] > BOUND[view]) failures.push(`b:quiet: the ${view} view ran ${counts[view]} times during a ${chunks}-chunk reply (bound ${BOUND[view]}, 2 per lifecycle edge for sessions)`);
        }
      }
      const grew = (["sessions", "turns", "board"] as const).filter((view) => long[view] !== short[view]);
      if (grew.length > 0) failures.push(`b:quiet: the run count changed with the reply's length: ${grew.map((view) => `${view} ${short[view]} at 40 chunks, ${long[view]} at 120`).join("; ")}`);
      if (grew.length === 0 && (["sessions", "turns", "board"] as const).every((view) => short[view] <= BOUND[view])) {
        evidence.push(`b: sessions ${short.sessions}, turns ${short.turns}, board ${short.board} view runs at 40 chunks and the same at 120`);
      }
    }
    // ---------------------------------------------------------------- c
    {
      const names = (topics: unknown, id: string) => JSON.stringify(topics).includes(`"${id}"`);
      const cases: Array<[string, Client, ReturnType<typeof viewRef>, unknown, string]> = [];
      cases.push(["bob's board with alice's session", bob.client, CODING_BOARD, { sessionId: conversation }, conversation]);
      cases.push(["bob's turns with alice's session", bob.client, SESSION_TURNS, { sessionId: conversation }, conversation]);
      // Alice's session in a second org.
      const elsewhere = `elsewhere_${RUN_STAMP}`;
      const own = (await stores.session.get(conversation))!;
      await stores.session.set(elsewhere, { ...own, id: elsewhere, orgId: "org_second", version: 0, lineageId: `lin_${elsewhere}` }, "absent" as never);
      cases.push(["alice's board with her second-org session", alice.client, CODING_BOARD, { sessionId: elsewhere }, elsewhere]);
      cases.push(["alice's turns with her second-org session", alice.client, SESSION_TURNS, { sessionId: elsewhere }, elsewhere]);
      // Alice's own write session (a roster write makes one).
      await createWorkforceClient(writer).hire({ id: "scribe", flow: "tasker" });
      const write = (await stores.session.list({ userId: "alice", parentage: "all" } as never)).find((s) => s.id.includes("fsd-write."));
      if (write !== undefined) cases.push(["alice's turns with her write session", alice.client, SESSION_TURNS, { sessionId: write.id }, write.id]);
      else failures.push("setup: alice has no write session to ask for");
      const leaks: string[] = [];
      for (const [what, client, ref, input, id] of cases) {
        const answer = await client.view(ref as never, input as never);
        const value = answer.value as unknown[];
        if ((Array.isArray(value) ? value.length : 0) > 0 || names(answer.topics, id)) leaks.push(`${what}: ${JSON.stringify(value).slice(0, 120)} · topics ${JSON.stringify(answer.topics)}`);
      }
      // Bob's own list of Lead holds none of alice's.
      const bobs = (await bob.client.view(WORKER_SESSIONS as never, { worker: "lead" } as never)).value as Array<{ id: string }>;
      if (bobs.some((s) => s.id === conversation)) leaks.push("bob's sessions list holds alice's conversation");
      tell.over("c:own-only · leaks", leaks, { emptyIs: "the claim: nothing of another's session answered or named" });
      if (leaks.length > 0) failures.push(`c:own-only: ${leaks.join(" | ")}`);
      else evidence.push(`c: ${cases.length + 1} cases answered nothing and named no topic`);
    }

    // ---------------------------------------------------------------- d
    {
      const before = (await stores.request.list({})).length;
      for (const [ref, input] of [[WORKER_SESSIONS, { worker: "lead" }], [SESSION_TURNS, { sessionId: conversation }], [CODING_BOARD, { sessionId: conversation }]] as const) {
        await alice.client.view(ref as never, input as never);
      }
      const after = (await stores.request.list({})).length;
      tell.over("d:no-actions · requests started by view runs", [after - before]);
      if (after !== before) failures.push(`d:no-actions: view runs started ${after - before} requests`);
      else evidence.push("d: three view runs started no request");
    }
  } finally {
    for (const stop of stops) stop();
    await handle?.close();
    await host.dispose();
  }
  console.error(`evidence: ${evidence.join(" · ")}`);
  return { failures, evidence: evidence.join(" · ") };
});
