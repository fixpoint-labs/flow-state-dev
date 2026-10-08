/**
 * Goal check — someone looking at a task on a board can open exactly the run
 * working it, or the run that last worked it, and never another task's run or
 * a guess.
 *
 * **Model-free on purpose.** A row is handed off, a run starts, or it doesn't.
 *
 * The comparison is always between what a READER gets from the board and what
 * each WORKER saw from inside its own run, written to a file outside the board.
 * Never against what the board or the hand-off said it did: those are
 * neighbours of the claim, generated on the path being tested.
 *
 * What the tree contributes: the mailbox, its board, the member that drains it,
 * and the members it hands rows to — each with its session policy, and one on a
 * flow of its own. Rename the team, the mailbox or the board, or swap which seat
 * is per-worker, and a correct build still passes.
 *
 * Legs:
 *   a        the tree alone produces the mailbox, the board and the seats
 *   ran      every row's run really ran, and left its proof on disk
 *   browser  the browser read of the board names each row's own run
 *   model    the model read (`readBoard`) names each row's own run
 *   stream   the last task-change on each run's own stream names that run
 *   shared   two rows in one per-worker session name one session, two requests
 *   redrain  a row re-drained from a second conversation names THAT drain's run
 *   marker   the cross-flow run opens through its session's owner, and returns
 *            the marker its worker emitted
 *
 * Controls (GOAL_CONTROL=...), each perturbing THIS FILE, never the tree:
 *   stamp-at-claim  the link is overwritten with the claiming conversation's
 *                   coordinate. Must FAIL at "session equals the worker's".
 *   server-only     `run` joins the server-only list, and leaves the browser
 *                   list. Must FAIL at "link present on the browser read".
 *   board-flow      each run is opened through the board's own flow instead of
 *                   its session's owner. Must FAIL at "marker read on the
 *                   cross-flow seat".
 *
 * Run: pnpm tsx goals/task-run-link/it-names-the-run-working-each-task/run.mts
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, ensureSessionRecord, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  getOrCreateTaskCollection,
  SERVER_ONLY_TASK_FIELDS,
  ticketForClaim,
  type Task,
  type TaskWorkerInput
} from "@flow-state-dev/orchestration/tasks";
import {
  MAILBOX_KIND,
  mailboxBoard,
  mailboxBoardIds,
  mailboxInstances,
  createWorkerInstallation,
  hireWorkforce,
  WORKER_ID_STATE_KEY,
  openMailboxes,
  workerConfigSchema,
  type MailboxManifest,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { readMailboxesDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import { goalTmpDir, runGoal, silentLogger, workerDoor } from "../../lib/index.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const USER_ID = "u_task_run_link";
const ORG_ID = DEFAULT_ORG_ID;
/** The two conversations that drain the board. */
const CONVO_A = "s_convo_a";
const CONVO_B = "s_convo_b";
/** The task entry every seat hands off to. */
const ENTRY = "work";
const MARKER_COMPONENT = "run-link-goal-marker";
/**
 * The kind a seat names when its rows run on the DRAINER's flow, as the
 * drainer. It holds no task entry of its own: the drainer's flow declares the
 * entry its hand-off addresses. Any other kind a seat names is a flow of its
 * own, which the seat's hand-off addresses, in a session naming the seat.
 */
const PASSIVE_KIND = "seat";

const CONTROL = process.env.GOAL_CONTROL ?? "";

/** Where each worker writes what it saw from inside its own run. */
const OUTBOX = join(goalTmpDir("task-run-link"), "proof.ndjson");

type Proof = { taskId: string; attempt: number; sessionId: string; requestId: string; marker: string };
type RunLink = { sessionId: string; requestId: string; attempt: number };

async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Parse an SSE body into its JSON `data:` frames. */
function sseFrames(body: string): Array<Record<string, any>> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => {
      try {
        return JSON.parse(line.slice("data: ".length)) as Record<string, any>;
      } catch {
        return {};
      }
    });
}

await runGoal(async () => {
  const failures: string[] = [];
  writeFileSync(OUTBOX, "", "utf8");

  // ---- a. the tree alone ----------------------------------------------------
  const roster = await readWorkforce(TREE);
  const read = await readMailboxesDirectory(TREE);
  if (roster.errors.length > 0 || read.errors.length > 0) {
    return {
      failures: [`the tree did not load cleanly: ${JSON.stringify([...roster.errors, ...read.errors])}`],
      evidence: ""
    };
  }
  const workers: WorkerManifest[] = roster.workers;
  const mailboxes: MailboxManifest[] = read.mailboxes;
  const mailbox = mailboxes.find((c) => ((c.declared.boards as string[] | undefined) ?? []).length > 0);
  if (mailbox === undefined) return { failures: ["the tree declared no mailbox holding a board"], evidence: "" };
  const boardName = (mailbox.declared.boards as string[])[0]!;
  const ledger = mailboxBoard(mailbox.id, boardName);

  // Members, off the mailbox file: the one that drains (a flow of its own, no
  // hand-off policy), and the seats it hands rows to (a declared policy).
  const byId = new Map(workers.map((w) => [w.id, w]));
  const members = ((mailbox.declared.members as string[] | undefined) ?? []).map((id) => byId.get(id)!);
  const drainer = members.find((w) => w.declared.flow !== undefined && w.declared.handoff === undefined);
  const seats = members
    .filter((w) => typeof w.declared.handoff === "string")
    .map((w) => ({
      id: w.id,
      name: w.id.split(".").at(-1)!,
      policy: w.declared.handoff as "per-task" | "per-worker",
      // A seat whose file names a flow of its own runs there, not on the drainer's.
      flow: w.declared.flow === PASSIVE_KIND ? undefined : (w.declared.flow as string | undefined)
    }));
  const crossFlow = seats.filter((s) => s.flow !== undefined);
  const perWorker = seats.filter((s) => s.policy === "per-worker");
  const perTaskHere = seats.filter((s) => s.policy === "per-task" && s.flow === undefined);
  if (drainer === undefined || crossFlow.length === 0 || perWorker.length === 0 || perTaskHere.length === 0) {
    return {
      failures: ["the tree must declare a draining member, a per-task seat, a per-worker seat and a seat on another flow"],
      evidence: ""
    };
  }

  // What a seat's file may declare beyond the worker contract: its policy.
  const seatConfig = workerConfigSchema().extend({ handoff: z.enum(["per-task", "per-worker"]).optional() });

  // ---- controls that change what is published ------------------------------
  if (CONTROL === "server-only") {
    (SERVER_ONLY_TASK_FIELDS as unknown as string[]).push("run");
    const expose = (ledger as unknown as { client: { expose: string[] } }).client.expose;
    expose.splice(expose.indexOf("run"), 1);
  }

  // ---- the worker: what it saw, from inside its own run --------------------
  const work = handler({
    name: "run-link-goal-work",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ marker: z.string() }),
    resources: { [ledger.id]: ledger },
    execute: async (input: TaskWorkerInput, ctx) => {
      if (CONTROL === "stamp-at-claim") {
        // The link filled from the claim's coordinate — the conversation that
        // drained the board — instead of from the run.
        const tasks = await getOrCreateTaskCollection({
          ctx,
          backing: "resource",
          collectionId: ledger.id,
          collection: (ctx.resources as unknown as Record<string, ResourceCollectionRef<never>>)[ledger.id]!
        });
        const row = tasks.get(input.taskId) as unknown as Task;
        await tasks.linkRun(
          row.id,
          { sessionId: row.claimedBy!.sessionId, requestId: row.claimedBy!.requestId, attempt: row.attempts },
          { claim: ticketForClaim(ledger.id, row) }
        );
      }
      const marker = `marker-${input.taskId}-${input.attempts}-${randomUUID()}`;
      ctx.emit.component(MARKER_COMPONENT, { marker });
      const proof: Proof = {
        taskId: input.taskId,
        attempt: input.attempts,
        sessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id,
        marker
      };
      appendFileSync(OUTBOX, `${JSON.stringify(proof)}\n`, "utf8");
      if ((input.input as { failFirst?: boolean } | undefined)?.failFirst === true && input.attempts === 1) {
        throw new Error("the first attempt fails on purpose, so the row is re-drained");
      }
      return { marker };
    }
  });

  // A row's session names its worker: the seat, on a flow of its own; the
  // drainer whose drain handed it over, on the drainer's flow.
  const address = (seat: (typeof seats)[number]) =>
    dispatcher<TaskWorkerInput>({
      name: `run-link-goal-hand-${seat.name}`,
      action: ENTRY,
      session: seat.policy,
      ...(seat.flow !== undefined
        ? { flowKind: seat.flow, state: { [WORKER_ID_STATE_KEY]: seat.id } }
        : { state: (_task, ctx) => ({ [WORKER_ID_STATE_KEY]: (ctx.session.state as Record<string, unknown>)[WORKER_ID_STATE_KEY] }) })
    });

  // The installation every worker flow below runs its workers on. It reads the
  // flows when it first needs them, so they are built on it below.
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => workerFlows as never });

  const BOARD_ID = `${ledger.id}-board`;
  const leadBoard = taskBoard({
    name: "run-link-goal-lead",
    boardId: BOARD_ID,
    collection: ledger,
    workers: Object.fromEntries(seats.map((seat) => [seat.name, address(seat)]))
  });
  const leadKind = defineFlow({
    kind: drainer.declared.flow as string,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { [ledger.id]: ledger, ...installation.resources },
    actions: { drain: { block: leadBoard.drain }, ...workerDoor },
    task: { actions: { [ENTRY]: { block: work } } }
  } as never);

  // A seat on another flow gates its entry with the same logical board: same
  // boardId, same ledger. Its own drain is never called.
  const otherKinds = Object.fromEntries(
    crossFlow.map((seat) => {
      const board = taskBoard({
        name: `run-link-goal-${seat.flow}`,
        boardId: BOARD_ID,
        collection: ledger,
        workers: { [seat.name]: address({ ...seat, flow: undefined }) }
      });
      return [
        seat.flow!,
        defineFlow({
          kind: seat.flow!,
          cardinality: "collection",
          configSchema: seatConfig,
          session: installation.session(),
          resources: { [ledger.id]: ledger, ...installation.resources },
          actions: { drain: { block: board.drain }, ...workerDoor },
          task: { actions: { [ENTRY]: { block: work } } }
        } as never)
      ];
    })
  );

  const passiveKind = defineFlow({
    kind: PASSIVE_KIND,
    cardinality: "collection",
    configSchema: seatConfig,
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { ...workerDoor,}
  } as never);

  const instances = mailboxInstances(mailboxes);
  workerFlows = {
    [drainer.declared.flow as string]: leadKind,
    [PASSIVE_KIND]: passiveKind,
    ...otherKinds
  };
  const hired = hireWorkforce(installation, { mailboxBoards: mailboxBoardIds(mailboxes) });
  const state = createFlowState({
    flows: {
      ...Object.fromEntries(instances.map((instance) => [instance.kind, instance])),
      ...Object.fromEntries(hired.map((seat) => [seat.id, seat]))
    },
    stores: { default: { primary: inMemoryStores() } },
    logger: silentLogger
  } as never);

  try {
    const runtime = await state.getRuntime();
    const router = (await state.getRouter()) as any;
    const get = async (path: string[]): Promise<{ status: number; text: string }> => {
      const response = await router.GET(new Request(`http://goal/api/flows/${path.join("/")}`), {
        params: { path }
      });
      return { status: response.status, text: await response.text() };
    };

    await openMailboxes(mailboxes, {
      client: {
        createSession: async (options: { flowKind: string; sessionId?: string; description?: string; state?: Record<string, unknown> }) => {
          const id = String(options.sessionId);
          const now = Date.now();
          await runtime.stores.session.set(
            id,
            {
              id,
              flowKind: options.flowKind,
              flowId: options.flowKind,
              userId: USER_ID,
              orgId: ORG_ID,
              description: options.description,
              state: options.state ?? {},
              lineageId: `lin_${id}`,
              version: 0,
              createdAt: now,
              updatedAt: now,
              journal: []
            } as never,
            "absent"
          );
          return { id };
        },
        getSession: async (sessionId: string) => {
          const found = (await runtime.stores.session.get(sessionId)) as any;
          return { flowKind: String(found?.flowKind), flowId: found?.flowId, userId: String(found?.userId), orgId: found?.orgId, state: found?.state };
        },
        deleteSession: async (sessionId: string) => {
          await runtime.stores.session.delete(sessionId);
        }
      },
      userId: USER_ID
    } as never);

    const act = async (flow: unknown, sessionId: string, actionName: string, input: unknown) =>
      (await runAction({
        flow,
        actionName,
        input,
        userId: USER_ID,
        orgId: ORG_ID,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      } as never)) as { output?: unknown; error?: unknown; requestId?: string };

    const mailboxInstance = instances.find((instance) => instance.kind === MAILBOX_KIND)!;
    const lead = hired.find((copy) => copy.kind === drainer.declared.flow)!;
    // The two conversations that drain the board, each created naming the drainer.
    for (const sessionId of [CONVO_A, CONVO_B]) {
      const now = Date.now();
      await ensureSessionRecord(
        runtime.stores,
        sessionId,
        {
          flow: lead as never,
          sessionId,
          principal: { userId: USER_ID, orgId: ORG_ID },
          state: { [WORKER_ID_STATE_KEY]: drainer.id },
          fromCaller: true,
          via: "create"
        },
        () =>
          ({
            id: sessionId,
            flowKind: lead.kind,
            flowId: lead.id,
            userId: USER_ID,
            orgId: ORG_ID,
            version: 0,
            createdAt: now,
            updatedAt: now,
            journal: []
          }) as never
      );
    }
    const row = async (taskId: string): Promise<Task | undefined> =>
      (await runtime.stores.resourceState.get("org", ORG_ID, `${ledger.id}/${taskId}`))?.state as Task | undefined;

    // ---- file the rows, through the mailbox ------------------------------
    type Filed = { taskId: string; seat: (typeof seats)[number]; retry: boolean };
    const filed: Filed[] = [];
    const file = async (seat: (typeof seats)[number], n: number, retry = false) => {
      const out = await act(mailboxInstance, mailbox.id, "fileTask", {
        board: boardName,
        goal: `${seat.name} row ${n}${retry ? " (fails once)" : ""}`,
        assignee: seat.name,
        input: retry ? { failFirst: true } : {},
        ...(retry ? { maxAttempts: 2 } : {})
      });
      if (out.error !== undefined) throw new Error(`filing for ${seat.name} failed: ${String(out.error)}`);
      filed.push({ taskId: (out.output as { taskId: string }).taskId, seat, retry });
    };
    for (const seat of seats) await file(seat, 1);
    for (const seat of perWorker) await file(seat, 2);
    await file(perTaskHere[0]!, 2, true);
    const retryRow = filed.find((f) => f.retry)!;

    // ---- drain from conversation A, then re-drain from B -----------------
    const drainA = await act(lead, CONVO_A, "drain", {});
    if (drainA.error !== undefined) failures.push(`drain from conversation A failed: ${String(drainA.error)}`);
    await until(async () => {
      for (const f of filed) {
        const r = await row(f.taskId);
        if (f.retry ? !(r?.status === "pending" && r.attempts === 1) : r?.status !== "completed") return false;
      }
      return true;
    }, "conversation A's runs to settle");
    const runAfterA = (await row(retryRow.taskId))?.run;

    const drainB = await act(lead, CONVO_B, "drain", {});
    if (drainB.error !== undefined) failures.push(`drain from conversation B failed: ${String(drainB.error)}`);
    await until(async () => (await row(retryRow.taskId))?.status === "completed", "conversation B's run to settle");

    // ---- ran: the proof, outside the board -------------------------------
    const proofs = readFileSync(OUTBOX, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Proof);
    const proofOf = (taskId: string, attempt: number) =>
      proofs.find((p) => p.taskId === taskId && p.attempt === attempt);
    for (const f of filed) {
      const r = await row(f.taskId);
      if (proofOf(f.taskId, r?.attempts ?? -1) === undefined) {
        failures.push(`ran: no proof on disk for ${f.taskId} attempt ${r?.attempts}`);
      }
    }

    /** Compare one reader's link against what the row's own worker recorded. */
    const judge = (leg: string, taskId: string, link: RunLink | undefined, attempts: number | undefined) => {
      const proof = proofOf(taskId, attempts ?? -1);
      if (link == null) {
        failures.push(`${leg}: link present on the ${leg} read — ${taskId} carries no run`);
        return;
      }
      if (proof === undefined) return;
      if (link.sessionId !== proof.sessionId) {
        failures.push(
          `${leg}: session equals the worker's — ${taskId} names ${link.sessionId}, its worker ran in ${proof.sessionId}`
        );
      }
      if (link.requestId !== proof.requestId) {
        failures.push(`${leg}: request equals the worker's — ${taskId} names ${link.requestId}, its worker ran as ${proof.requestId}`);
      }
      if (link.attempt !== attempts) {
        failures.push(`${leg}: attempt equals the row's — ${taskId} names attempt ${link.attempt}, the row is on ${attempts}`);
      }
    };

    // ---- browser: the board's browser read --------------------------------
    const browser = await get(["sessions", mailbox.id, "resources", ledger.id]);
    if (browser.status !== 200) failures.push(`browser: the board read answered ${browser.status}: ${browser.text}`);
    const cards = new Map<string, Record<string, unknown>>(
      ((JSON.parse(browser.text || "{}").items ?? []) as Array<{ clientData: Record<string, unknown> }>).map((i) => [
        String(i.clientData.id),
        i.clientData
      ])
    );
    for (const f of filed) {
      const card = cards.get(f.taskId);
      judge("browser", f.taskId, card?.run as RunLink | undefined, card?.attempts as number | undefined);
      if (card !== undefined && "claimedBy" in card) failures.push(`browser: ${f.taskId} carries claimedBy`);
    }

    // ---- model: readBoard ------------------------------------------------
    const model = await act(mailboxInstance, mailbox.id, "readBoard", { board: boardName });
    const modelRows = new Map(((model.output as { tasks?: Task[] } | undefined)?.tasks ?? []).map((t) => [t.id, t]));
    for (const f of filed) {
      const t = modelRows.get(f.taskId);
      judge("model", f.taskId, t?.run, t?.attempts);
    }

    // ---- stream + marker: open each run from its link ---------------------
    // Its owner is read off the session the link names — never assumed to be
    // the board's flow.
    let markersRead = 0;
    for (const f of filed) {
      const r = await row(f.taskId);
      const link = r?.run;
      if (link == null) {
        failures.push(`stream: link present on the stored row — ${f.taskId} carries no run to open`);
        continue;
      }
      const session = await get(["sessions", link.sessionId]);
      const owner = session.status === 200 ? (JSON.parse(session.text).session?.flowId as string | undefined) : undefined;
      if (owner === undefined) {
        failures.push(`stream: the session ${link.sessionId} could not be read (${session.status})`);
        continue;
      }
      const via = CONTROL === "board-flow" ? lead.id : owner;
      const stream = await get([via, "requests", link.requestId, "stream"]);
      const frames = stream.status === 200 ? sseFrames(stream.text) : [];
      const items = frames.map((frame) => frame.item).filter((item) => item?.type === "component");
      const changes = items.filter((item) => item.component === "task-change" && item.data?.taskId === f.taskId);
      const marker = items.find((item) => item.component === MARKER_COMPONENT)?.data?.marker as string | undefined;
      const proof = proofOf(f.taskId, r!.attempts);

      if (f.seat.flow !== undefined) {
        if (marker === undefined || marker !== proof?.marker) {
          failures.push(
            `marker: marker read on the cross-flow seat — opening ${f.taskId}'s run through "${via}" answered ` +
              `${stream.status} and returned ${marker === undefined ? "no marker" : `"${marker}"`}, its worker emitted "${proof?.marker}"`
          );
        } else {
          markersRead += 1;
        }
      }
      if (stream.status !== 200) {
        // board-flow opens the cross-flow run through the wrong flow; that
        // failure is the marker leg's to name.
        if (!(CONTROL === "board-flow" && f.seat.flow !== undefined)) {
          failures.push(`stream: ${f.taskId}'s run stream answered ${stream.status} through "${via}"`);
        }
        continue;
      }
      const last = changes.at(-1)?.data?.task as (Task & Record<string, unknown>) | undefined;
      judge("stream", f.taskId, last?.run, last?.attempts);
      if (last !== undefined && "claimedBy" in last) failures.push(`stream: ${f.taskId}'s change item carries claimedBy`);
    }

    // ---- shared: per-worker rows share a session, not a request ------------
    for (const seat of perWorker) {
      const mine = await Promise.all(filed.filter((f) => f.seat.id === seat.id).map((f) => row(f.taskId)));
      const links = mine.map((r) => r?.run);
      if (links.length === 2 && links.every((l) => l != null)) {
        if (links[0]!.sessionId !== links[1]!.sessionId) failures.push(`shared: ${seat.name}'s two rows name two sessions`);
        if (links[0]!.requestId === links[1]!.requestId) failures.push(`shared: ${seat.name}'s two rows name one request`);
      }
    }

    // ---- redrain: the second conversation's run, not the first's ----------
    const retried = await row(retryRow.taskId);
    const first = proofOf(retryRow.taskId, 1);
    const second = proofOf(retryRow.taskId, 2);
    if (retried?.attempts !== 2 || first === undefined || second === undefined) {
      failures.push(`redrain: the row was not re-drained (attempts ${retried?.attempts})`);
    } else {
      if (runAfterA?.sessionId !== first.sessionId) {
        failures.push(`redrain: after the failed first attempt the row named ${runAfterA?.sessionId}, not the failed run ${first.sessionId}`);
      }
      if (retried.run?.sessionId === first.sessionId) {
        failures.push(`redrain: the re-drained row still names conversation A's run ${first.sessionId}`);
      }
      if (first.sessionId === second.sessionId) {
        failures.push("redrain: the two conversations' runs share a session, so this leg proves nothing");
      }
    }

    return {
      failures,
      evidence:
        `mailbox "${mailbox.id}", board "${boardName}" (ledger ${ledger.id}), drained by "${drainer.id}" from ` +
        `${CONVO_A} and re-drained from ${CONVO_B}. ${filed.length} rows across seats ` +
        `${seats.map((s) => `${s.name}:${s.policy}${s.flow ? `@${s.flow}` : ""}`).join(", ")}; every row's link on ` +
        `the browser read, the model read and the last task-change of its run's own stream equals the session and ` +
        `request its worker recorded from inside the run (${proofs.length} proofs on disk). ` +
        `${perWorker.map((s) => s.name).join(", ")} shared one session over two requests; the re-drained row ` +
        `${retryRow.taskId} moved from ${first?.sessionId} (A, attempt 1, failed) to ${second?.sessionId} (B, attempt 2); ` +
        `${markersRead} cross-flow run(s) opened through their session's owner and returned the worker's marker.`
    };
  } finally {
    await state.dispose();
  }
});
