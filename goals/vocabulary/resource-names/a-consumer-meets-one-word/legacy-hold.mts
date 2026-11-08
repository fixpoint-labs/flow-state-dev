/**
 * The integration leg of `a-consumer-meets-one-word`: a task stored with a
 * hold in the old shape (`source.kind: "row"`) is listed by the Inbox read as
 * `"task"`, answered through the board's `updateTask` the way the Inbox client
 * answers it, and the hold closes. Once for a question, once for a confirm.
 *
 * A real `createFlowState` host on its in-memory stores, one flow with one
 * task board and its task tools as actions, driven as a verified caller. The
 * task is filed through `createTask`, then its stored record is rewritten to
 * the old marker: the input is a record an earlier version wrote, so the
 * store write is the input, never the read. Everything after reads through the
 * board's own actions (`listTasks`, `getTask`), lists through orchestration's
 * `inboxItems`, and answers through `createInboxClient`.
 *
 * Prints one JSON line, `{ failures, evidence }`, for the goal's run to grade.
 *
 * Run (on its own): pnpm tsx goals/vocabulary/resource-names/a-consumer-meets-one-word/legacy-hold.mts
 */
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState } from "@flow-state-dev/engine";
import { taskBoard, taskToolActions } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection, openHolds, type Task, type TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { createInboxClient, inboxItems, type InboxAnswer, type InboxItem } from "@flow-state-dev/orchestration/inbox";
import { actingAs, silentLogger, untilIdle } from "../../../lib/index.mts";

const FLOW = "legacy-hold";
const BOARD = "tasks";
const USER = "u_legacy_hold";
const ORG = "org_legacy_hold";
/** The marker an earlier version stored on a task's own hold. */
const OLD_MARKER = "row";

const noopWorker = handler({ name: "legacy-hold-worker", inputSchema: z.unknown(), outputSchema: z.null(), execute: () => null }) as TaskWorker;

const tasks = defineTaskCollection({ id: BOARD, scope: "session" });
const board = taskBoard({ name: BOARD, collection: tasks, workers: noopWorker });
const flow = defineFlow({ kind: FLOW, actions: { ...taskToolActions(board) } } as never);

const state = createFlowState({
  flows: { [FLOW]: flow },
  logger: silentLogger,
  resolvePrincipal: (context: any) => {
    const user = context.request?.headers.get("x-user");
    return typeof user === "string" ? { userId: user, orgId: ORG } : null;
  },
} as never);
const runtime = await state.getRuntime();
const http = actingAs((await state.getRouter()) as never, USER);
const session = await http.open(FLOW, {});

const failures: string[] = [];
const evidence: string[] = [];
const show = (value: unknown) => JSON.stringify(value);

/** Rewrite the stored task `id` so each of its own holds carries the old marker, as an earlier version wrote it. */
async function storeInTheOldShape(id: string): Promise<void> {
  const keys = Object.keys(await runtime.stores.resourceState.getByPrefix("session", session, `${BOARD}/`));
  for (const key of keys) {
    const stored = await runtime.stores.resourceState.get("session", session, key);
    const task = stored?.state as Task | undefined;
    if (task?.id !== id) continue;
    const holds = (task.holds ?? []).map((hold) => (hold.source.kind === "suspension" ? hold : { ...hold, source: { ...hold.source, kind: OLD_MARKER } }));
    const written = await runtime.stores.resourceState.set("session", session, key, { ...task, holds } as never, stored!.version);
    if (!written.ok) throw new Error(`rewriting ${id} in the old shape conflicted`);
    const back = (await runtime.stores.resourceState.get("session", session, key))?.state as { holds?: Array<{ source: { kind: string } }> };
    if (!back.holds?.every((hold) => hold.source.kind === OLD_MARKER)) throw new Error(`${id} did not store in the old shape: ${show(back.holds)}`);
    return;
  }
  throw new Error(`no stored task ${id} under ${BOARD}/`);
}

/** The Inbox over the board's public read: one item per task holding the user. */
async function inbox(): Promise<InboxItem[]> {
  const listed = (await http.act(FLOW, session, `listTasks_${BOARD}`, {}))?.tasks ?? [];
  const rows = listed.map((task: Task) => ({
    board: BOARD,
    id: task.id,
    goal: task.goal,
    status: task.status,
    holds: task.holds ?? [],
    steers: task.steers ?? [],
    holder: { sessionId: session, action: `updateTask_${BOARD}` },
  }));
  return inboxItems({ rows, suspensions: [], flowOf: () => FLOW });
}

async function getTask(id: string): Promise<Task | undefined> {
  const read = await http.act(FLOW, session, `getTask_${BOARD}`, { id });
  return read?.ok === true ? (read.task as Task) : undefined;
}

/** File a task held on one own hold of `kind`, store it in the old shape, list it, answer it, and read it back. */
async function leg(kind: "question" | "confirm", answer: InboxAnswer): Promise<void> {
  const tag = `hold:${kind}`;
  const filed = await http.act(FLOW, session, `createTask_${BOARD}`, { goal: `Legacy ${kind}`, questions: [{ kind, prompt: `Which ${kind}?` }] });
  if (filed?.ok !== true) throw new Error(`filing the ${kind} was refused: ${show(filed)}`);
  const id = filed.taskId as string;
  await untilIdle(runtime.stores);
  await storeInTheOldShape(id);

  const item = (await inbox()).find((i) => i.task?.taskId === id);
  if (item === undefined) {
    failures.push(`${tag}:listed — the Inbox read lists no item for the task stored with a "${OLD_MARKER}" hold`);
    return;
  }
  const kinds = item.holds.map((hold) => hold.source.kind);
  if (kinds.length !== 1 || kinds[0] !== "task") failures.push(`${tag}:reads-as-task — the Inbox read lists its hold as ${show(kinds)}, not ["task"]`);
  if (!item.answerable) failures.push(`${tag}:answerable — the listed hold is not answerable: ${item.unanswerable}`);

  try {
    await createInboxClient(http.client).answer(item, answer as never);
  } catch (error) {
    failures.push(`${tag}:answered — the Inbox client's answer through updateTask was refused: ${(error as Error).message}`);
    return;
  }
  await untilIdle(runtime.stores);

  const after = await getTask(id);
  if (after === undefined) {
    failures.push(`${tag}:closes — getTask no longer reads the task`);
    return;
  }
  const open = openHolds(after).map((hold) => hold.id);
  if (open.length > 0) failures.push(`${tag}:closes — the hold is still open after its answer: ${show(open)}`);
  if ((await inbox()).some((i) => i.task?.taskId === id)) failures.push(`${tag}:leaves-the-inbox — the Inbox still lists the task after its answer`);
  evidence.push(`${kind}: stored "${OLD_MARKER}", listed ${show(kinds)}, answered through updateTask, ${open.length} open after, task ${after.status}`);
}

try {
  await leg("question", { text: "The March export" });
  await leg("confirm", { done: true });
} catch (error) {
  failures.push(`threw: ${(error as Error).message}`);
}
console.log(JSON.stringify({ failures, evidence }));
process.exit(0);
