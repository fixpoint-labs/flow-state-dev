/**
 * Goal check — a task on a mailbox's task list names a worker, including one
 * hired a moment ago, and that worker receives the task and runs it.
 *
 * One app, played the way a host plays it: a mailbox with one task list that
 * no worker kind was wired to, the `agent` kind taking tasks from the
 * mailbox's lists, a coordinator flow holding the hire tool and a board over
 * the list whose fallback asks the worker lookup who a name means. The legs
 * act only through the coordinator's hire, the mailbox's `fileTask` and the
 * coordinator's drain. Nothing here registers a worker by hand, calls the
 * lookup, or seeds a row.
 *
 * Legs:
 *   a  an `agent` worker hired after start is handed a task filed for it by name
 *   b  the same, for a worker hired before a restart
 *   c  a worker the files declare, on a list no code wired it to
 *   d  a name nobody holds is refused at filing, and no row exists
 *
 * Each of a–c passes only when the task settles `completed` with the held-out
 * word in its result, the run that settled it is on the named worker's own
 * flow (its id is the worker's address), that run's input holds the task's
 * goal, and no other flow ran the task.
 *
 * Run: pnpm tsx goals/mailbox-boards/it-hands-a-task-to-a-fresh-hire/run.mts
 * Controls (must FAIL leg a on "a run on the hire's flow"):
 *   GOAL_CONTROL=fixed-routes  the board has only a fixed route per declared worker, no lookup
 *   GOAL_CONTROL=pinned-gate   the agent kind takes tasks only from a list of its own
 */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineFlow, dispatcher } from "@flow-state-dev/core";
import type { FlowInstance, TaskFlowTarget } from "@flow-state-dev/core/types";
import { createFlowState, createModelResolver, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime } from "@flow-state-dev/engine";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
  createSeatHireBlocks,
  createWorkerLookup,
  defineAgentWorkerFlow,
  defineHiredRosterCollection,
  defineMailboxFlow,
  defineSeatInventoryCollection,
  hireWorkforce,
  mailboxBoard,
  mailboxBoardIds,
  mailboxInstances,
  openMailboxes,
  reloadHiredSeats,
  seatAddress,
  type MailboxManifest,
  type WorkerLookup
} from "@flow-state-dev/workforce";
import { readMailboxesDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import { runGoal } from "../../lib/index.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const MODEL = "openai/gpt-5.4-mini";
const ORG_ID = "org_fresh_hire";
const USER_ID = "u_coordinator";
const CONTROL = process.env.GOAL_CONTROL ?? "";

// A bare createModelResolver rejects an env intent-ladder override; clear it so
// the resolver wires the AI Gateway from AI_GATEWAY_API_KEY.
for (const key of Object.keys(process.env)) {
  if (key === "FSDEV_DEFAULT_MODEL" || key.startsWith("FSDEV_INTENT_")) delete process.env[key];
}

type Act = (flow: FlowInstance, sessionId: string, actionName: string, input: unknown) => Promise<{ output?: any; error?: any }>;

interface Host {
  runtime: FlowStateRuntime;
  act: Act;
  mailbox: FlowInstance;
  mailboxId: string;
  listName: string;
  listId: string;
  coordinator: FlowInstance;
  declaredWorker: string;
  dispose: () => Promise<void>;
}

/** Boot the app over `adapter`: what a host does at start, including reloading its hires. */
async function boot(adapter: unknown): Promise<Host> {
  const roster = await readWorkforce(TREE);
  const read = await readMailboxesDirectory(TREE);
  if (roster.errors.length > 0 || read.errors.length > 0) throw new Error("the tree did not load cleanly");
  const mailboxes: MailboxManifest[] = read.mailboxes;
  const holding = mailboxes.find((m) => ((m.declared.boards as string[] | undefined) ?? []).length > 0)!;
  const listName = (holding.declared.boards as string[])[0]!;
  const list = mailboxBoard(holding.id, listName);
  const listIds = mailboxBoardIds(mailboxes);

  let lookup: WorkerLookup | undefined;
  let runtime: FlowStateRuntime | undefined;

  // Under `pinned-gate` a worker takes tasks only from a list of its own,
  // the way a kind that declares its own board does.
  const agent = defineAgentWorkerFlow({
    model: MODEL,
    taskLists: CONTROL === "pinned-gate" ? [mailboxBoard("ops.own", listName).id] : listIds
  });
  const kinds = { agent } as never;
  const declared = hireWorkforce(roster.workers, { kinds, mailboxBoards: listIds });
  const declaredWorker = declared[0]!.id;

  const [mailbox] = mailboxInstances(mailboxes, {
    kinds: {
      mailbox: defineMailboxFlow({
        checkAssignee: (name, listId, ctx) => lookup!.filingCheck()(name, listId, ctx)
      }) as never
    }
  });

  let state: ReturnType<typeof createFlowState> | undefined;
  const hire = createSeatHireBlocks({
    kinds,
    register: (seat, pin) => state!.register(seat, { pin }),
    unregister: (id) => state!.unregister(id),
    kindAt: (id) => runtime?.registry.get(id)?.kind,
    instanceAt: (id) => runtime?.registry.get(id)
  });

  // The coordinator's board over the list. Its fallback hands each task to
  // whichever worker its name means; under `fixed-routes` it holds one fixed
  // route per worker the files declare, and nothing else.
  const handOver = (name: string, flowKind: string | TaskFlowTarget) =>
    dispatcher({ name, action: "work", session: "per-task", flowKind } as never);
  const board = taskBoard({
    name: "desk",
    boardId: list.id,
    collection: list,
    concurrency: 1,
    ...(CONTROL === "fixed-routes"
      ? { workers: Object.fromEntries(declared.map((w) => [w.id, handOver(`route-${w.id}`, w.id)])) }
      : {
          workers: {},
          defaultWorker: handOver("hand-over", (task, ctx) => lookup!.flowKind(task, ctx))
        })
  } as never);
  const coordinator = defineFlow({
    kind: "coordinator",
    resources: {
      [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
      [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection()
    },
    actions: { hire: { block: hire.hire }, drain: { block: board.drain } }
  } as never)({ id: "coordinator" }) as FlowInstance;

  state = createFlowState({
    flows: {
      [mailbox!.kind]: mailbox!,
      [coordinator.id]: coordinator,
      ...Object.fromEntries(declared.map((w) => [w.id, w]))
    },
    stores: { default: { primary: adapter } },
    modelResolver: createModelResolver()
  } as never);
  runtime = await state.getRuntime();
  const live = runtime;

  // The host's boot: workers hired before this start come back.
  const reloaded = await reloadHiredSeats({ stores: live.stores, orgIds: [ORG_ID], kinds });
  for (const seat of reloaded.seats) state.register(seat, { pin: seat.ownerPin! });
  lookup = createWorkerLookup({ instanceAt: (id) => live.registry.get(id), declared: declared.map((w) => w.id) });

  await openMailboxes(mailboxes, { client: sessionApi(live), userId: USER_ID }).catch(() => undefined);

  const act: Act = async (flow, sessionId, actionName, input) => {
    try {
      return (await runAction({
        flow,
        actionName,
        input,
        userId: USER_ID,
        orgId: ORG_ID,
        sessionId,
        stores: live.stores,
        runtimeConfig: { ...live.runtimeConfig }
      } as never)) as { output?: any; error?: any };
    } catch (error) {
      return { error };
    }
  };

  return {
    runtime: live,
    act,
    mailbox: mailbox!,
    mailboxId: holding.id,
    listName,
    listId: list.id,
    coordinator,
    declaredWorker,
    dispose: () => state!.dispose()
  };
}

/** File a task for `name`, drain the list, and grade what ran it. */
async function leg(h: Host, label: string, name: string, address: string, failures: string[]): Promise<string> {
  const word = randomBytes(4).toString("hex");
  const goal = `Reply with the word ${word} and nothing else.`;
  const filed = await h.act(h.mailbox, h.mailboxId, "fileTask", { board: h.listName, goal, assignee: name });
  const taskId = filed.output?.taskId as string | undefined;
  if (taskId === undefined) {
    failures.push(`${label}: the task for "${name}" was not filed: ${String(filed.error?.message ?? filed.error)}`);
    return `${label}: not filed`;
  }

  const drained = await h.act(h.coordinator, "s_coordinator", "drain", {});
  if (drained.error !== undefined) failures.push(`${label}: the drain failed: ${String(drained.error?.message ?? drained.error)}`);

  let row: Record<string, any> | undefined;
  for (let i = 0; i < 600; i += 1) {
    row = (await h.runtime.stores.resourceState.get("org", ORG_ID, `${h.listId}/${taskId}`))?.state as Record<string, any> | undefined;
    if (row?.status === "completed" || row?.status === "errored") break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // A run on the named worker's flow: the run the row links to.
  const linked = row?.run?.sessionId === undefined ? undefined : await h.runtime.stores.session.get(row.run.sessionId);
  const runFlow = (linked as { flowId?: string } | undefined)?.flowId;
  if (runFlow !== address) {
    failures.push(`${label}: no run on the hire's flow — the task's run is on ${JSON.stringify(runFlow)}, not "${address}" (row ${row?.status}: ${row?.error ?? ""})`);
  }
  // That run's input holds this task's goal.
  const request = row?.run?.requestId === undefined ? undefined : await h.runtime.stores.request.get(row.run.requestId);
  if (!JSON.stringify((request as { input?: unknown } | undefined)?.input ?? "").includes(word)) {
    failures.push(`${label}: the run's input does not hold the task's goal`);
  }
  // No other flow ran it.
  const all = await h.runtime.stores.request.list({ userId: USER_ID });
  const others = all.filter(
    (r) => (r as { input?: { taskId?: string } }).input?.taskId === taskId && (r as { flowId?: string }).flowId !== address
  );
  if (others.length > 0) failures.push(`${label}: ${others.length} run(s) on other flows took the task`);
  if (row?.status !== "completed") failures.push(`${label}: the task is ${row?.status}, not completed`);
  if (!String(row?.output ?? "").toLowerCase().includes(word)) {
    failures.push(`${label}: the result ${JSON.stringify(row?.output)} does not hold the word ${word}`);
  }
  return `${label}: "${name}" → ${row?.status} on ${runFlow}, result ${JSON.stringify(row?.output)} (word ${word})`;
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const adapter = inMemoryStores();

  // ---- a. hired after start ---------------------------------------------------
  let h = await boot(adapter);
  const freshName = `licenses-${randomBytes(2).toString("hex")}`;
  const hired = await h.act(h.coordinator, "s_coordinator", "hire", {
    seatId: freshName,
    flow: "agent",
    instructions: "You audit our dependencies' licenses. When a task asks for one word, reply with only that word."
  });
  const freshAddress = seatAddress(ORG_ID, freshName);
  if (hired.output?.address !== freshAddress) {
    failures.push(`a: the hire did not land: ${String(hired.error?.message ?? JSON.stringify(hired.output))}`);
  } else {
    evidence.push(await leg(h, "a", freshName, freshAddress, failures));
  }

  // ---- b. hired before a restart ----------------------------------------------
  const keptName = `keeper-${randomBytes(2).toString("hex")}`;
  const kept = await h.act(h.coordinator, "s_coordinator", "hire", {
    seatId: keptName,
    flow: "agent",
    instructions: "When a task asks for one word, reply with only that word."
  });
  if (kept.error !== undefined) failures.push(`b: the hire did not land: ${String(kept.error?.message ?? kept.error)}`);
  await h.dispose();
  h = await boot(adapter);
  evidence.push(await leg(h, "b", keptName, seatAddress(ORG_ID, keptName), failures));

  // ---- c. a declared worker, on a list no code wired it to --------------------
  evidence.push(await leg(h, "c", h.declaredWorker, h.declaredWorker, failures));

  // ---- d. a name nobody holds ---------------------------------------------------
  const ghost = `nobody-${randomBytes(2).toString("hex")}`;
  const refused = await h.act(h.mailbox, h.mailboxId, "fileTask", { board: h.listName, goal: "never filed", assignee: ghost });
  const listed = await h.act(h.mailbox, h.mailboxId, "readBoard", { board: h.listName });
  const ghostRows = ((listed.output?.tasks ?? []) as Array<{ assignee?: string }>).filter((t) => t.assignee === ghost);
  if (refused.error === undefined) failures.push(`d: a task for "${ghost}" was filed`);
  else if (!String(refused.error?.message).includes(ghost)) failures.push(`d: the refusal does not name "${ghost}": ${refused.error?.message}`);
  if (ghostRows.length > 0) failures.push(`d: ${ghostRows.length} row(s) exist for "${ghost}"`);
  evidence.push(`d: "${ghost}" → ${String(refused.error?.message ?? "filed")}`);

  await h.dispose();
  return { failures, evidence: evidence.join("\n") };
});

/** `openMailboxes`'s session API, as the session route would bind it. */
function sessionApi(runtime: FlowStateRuntime) {
  const stores = runtime.stores;
  return {
    createSession: async (options: { flowKind: string; userId: string; sessionId?: string; orgId?: string; description?: string; state?: Record<string, unknown> }) => {
      const id = String(options.sessionId);
      if ((await stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" exists`), { status: 409 });
      }
      const now = Date.now();
      await stores.session.set(
        id,
        {
          id,
          flowKind: options.flowKind,
          flowId: options.flowKind,
          userId: options.userId,
          orgId: options.orgId ?? ORG_ID,
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
      const found = (await stores.session.get(sessionId)) as
        | { flowKind: string; flowId?: string; userId: string; orgId?: string; state?: Record<string, unknown> }
        | undefined;
      return { flowKind: String(found?.flowKind), flowId: found?.flowId, userId: String(found?.userId), orgId: found?.orgId, state: found?.state };
    },
    deleteSession: async (sessionId: string) => {
      await stores.session.delete(sessionId);
    }
  };
}
