/**
 * Read the tree, build the installation and the two kinds on it, register one
 * copy of each, and hand back what `fsdev.config.mts` serves and what the
 * checks need to read. Every seat is a worker on its kind's one copy; a
 * session names the worker it runs.
 *
 * Every file it reads is found by walking from one root; no seat, mailbox or
 * board is named in this code. The minted ledger id is not written anywhere
 * under this lab — including in this comment — because a check greps every
 * file for it.
 *
 * ## The three things that are the lab's rather than the framework's
 *
 * 1. **The two kinds** (`workforce/flows/workers/`).
 * 2. **The desk -> seat map.** It is the app's, supplied by the caller and
 *    never read off the tree. That is what lets `swapped-desks` and `one-seat`
 *    move the routing while each seat's own `WORKER.md` still says where a row
 *    should have gone.
 * 3. **The refusal policy.** `readDeclaredRoster` collects problems rather than
 *    throwing, which is right for a library and wrong here: a seat that failed
 *    to load is a seat this lab does not have, and a short roster that still
 *    runs proves something other than what is claimed.
 */

import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { runAction } from "@flow-state-dev/engine";
import {
  MAILBOX_KIND,
  mailboxBoard,
  mailboxBoardIds,
  mailboxInstances,
  createWorkerInstallation,
  hireWorkforce,
  openMailboxes,
  openInventory,
  type MailboxManifest,
  type InventoryActionRequest,
  type OpenMailboxesOptions,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster, type DeclaredRoster } from "@flow-state-dev/workforce/loader";
import { fileURLToPath } from "node:url";
import { PLANNER_KIND, definePlannerFlow } from "./workforce/flows/workers/planner.mts";
import { WORKER_KIND, defineWorkerFlow, type WorkerControl } from "./workforce/flows/workers/worker.mts";

/** The authored tree — the one path this code names. Everything else is walked. */
export const LAB_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/** Who the lab runs as — one person, one principal (ER-1, D7). */
export const LAB_USER_ID = "u_multi_seat_collab";

/** The served database, relative to the server's working directory. */
export const LAB_DB_PATH = ".fsdev/data/multi-seat-collab.db";

/** Everything the tree says, read once and refused whole if any of it did not load. */
export interface LabTree {
  roster: DeclaredRoster;
  /** The one mailbox the tree declares. */
  mailbox: MailboxManifest;
  /** The board's LOCAL name, as `MAILBOX.md` wrote it. */
  boardName: string;
  /** The MINTED ledger id. Appears in no file — a check greps for it. */
  boardId: string;
  /** The planner seat's id, read off the tree. */
  plannerId: string;
  /** The worker seat ids, in tree order. */
  workerIds: string[];
  /** Seat id -> the flow it runs on, whose one copy every seat of that flow shares. */
  seatFlows: Record<string, string>;
  /**
   * Seat id -> the desk that seat's OWN `WORKER.md` answers for. **The oracle.**
   * Read by the checks, never by the routing.
   */
  declaredDesks: Record<string, string>;
}

/**
 * Read the tree and refuse it whole if anything in it did not load.
 *
 * @throws Naming every problem in one pass, or the first missing fact.
 */
export async function readLabTree(root: string = LAB_TREE): Promise<LabTree> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) {
    const lines = roster.problems.map((problem) => `${problem.layer} ${problem.path}: ${problem.error.message}`);
    throw new Error(`the tree at ${root} did not load cleanly:\n  - ${lines.join("\n  - ")}`);
  }
  if (roster.mailboxes.length !== 1) {
    throw new Error(`the tree at ${root} declares ${roster.mailboxes.length} mailboxes; this lab runs one`);
  }
  const mailbox = roster.mailboxes[0]!;
  // Read off the FILE. Rename the team, the mailbox folder or the board and a
  // correct implementation still passes.
  const boardName = (mailbox.declared.boards as string[] | undefined)?.[0];
  if (boardName === undefined) throw new Error(`mailbox "${mailbox.id}" declares no board`);

  // Exactly the declared topology — one planner, two workers, nothing else. A
  // stray third worker would still hire and drain, and the proof would be
  // about a different team than the one it names (BR-1).
  const planners = roster.workers.filter((worker) => worker.declared.flow === PLANNER_KIND);
  const workers = roster.workers.filter((worker) => worker.declared.flow === WORKER_KIND);
  if (planners.length !== 1 || workers.length !== 2 || roster.workers.length !== 3) {
    throw new Error(
      `the tree at ${root} hires ${planners.length} "${PLANNER_KIND}" and ${workers.length} "${WORKER_KIND}" ` +
        `seat(s) among ${roster.workers.length}; this lab is exactly one planner and two workers ` +
        `(${roster.workers.map((worker) => worker.id).join(", ")})`,
    );
  }
  const planner = planners[0]!;
  const declaredDesks: Record<string, string> = {};
  for (const worker of workers) {
    const desk = worker.declared.answersFor;
    if (typeof desk !== "string" || desk.length === 0) {
      throw new Error(`seat "${worker.id}" declares no answersFor`);
    }
    declaredDesks[worker.id] = desk;
  }

  return {
    roster,
    mailbox,
    boardName,
    boardId: mailboxBoard(mailbox.id, boardName).id,
    plannerId: planner.id,
    workerIds: workers.map((worker) => worker.id),
    seatFlows: { [planner.id]: PLANNER_KIND, ...Object.fromEntries(workers.map((worker) => [worker.id, WORKER_KIND])) },
    declaredDesks,
  };
}

export interface HireLabOptions {
  /** The tree, already read. */
  tree: LabTree;
  /** Desk key -> seat id. **The app's routing, and the thing under test.** */
  routes: Readonly<Record<string, string>>;
  /** Where each attempt leaves its line. */
  outbox: string;
  /** A worker-body perturbation, or none. */
  workerControl?: WorkerControl;
  /**
   * `false` hires the mailbox as if its `MAILBOX.md` had not opted in to its
   * board's task actions — the `mailbox-actions-off` control. The file is
   * left as written.
   */
  boardActions?: boolean;
}

/**
 * Build the installation and the kinds, and register one copy of each, plus
 * the mailbox singleton.
 *
 * `hireWorkforce` refuses the WHOLE roster when any worker would be refused
 * on its first turn, so a refusal cannot leave a short roster running.
 *
 * @returns The flow instances by id — what a `FlowState` registers.
 */
export function hireLab(options: HireLabOptions): Record<string, FlowInstance> {
  const { tree } = options;
  const board = mailboxBoard(tree.mailbox.id, tree.boardName);
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: tree.roster.workers,
    workerFlows: () => workerFlows as never,
  });
  workerFlows = {
    [WORKER_KIND]: defineWorkerFlow({
      installation,
      board,
      routes: options.routes,
      outbox: options.outbox,
      ...(options.workerControl === undefined ? {} : { control: options.workerControl }),
    }),
    [PLANNER_KIND]: definePlannerFlow({ installation, mailboxId: tree.mailbox.id, boardName: tree.boardName }),
  };
  const copies = hireWorkforce(installation, { mailboxBoards: mailboxBoardIds([tree.mailbox]) });

  const { boardActions: _optIn, ...withoutOptIn } = tree.mailbox.declared;
  const mailbox =
    options.boardActions === false ? { ...tree.mailbox, declared: withoutOptIn } : tree.mailbox;
  return {
    // The inventory's writer half on the built-in mailbox kind, as the
    // inventory docs tell every app to build it. `openLab` runs the write.
    ...Object.fromEntries(
      mailboxInstances([mailbox], { inventory: true }).map((instance) => [instance.kind, instance]),
    ),
    ...Object.fromEntries(copies.map((copy) => [copy.id, copy])),
  };
}

/** The organization every lab session runs in: the lab configures no resolver. */
export const LAB_ORG_ID = DEFAULT_ORG_ID;

/** The part of a served `FlowState` the boot needs. */
export interface LabServer {
  getRouter(): Promise<unknown>;
  getRuntime(): Promise<{ stores: unknown; runtimeConfig: unknown }>;
}

/**
 * The documented boot, in-process, after the server is built: open the
 * mailbox, then — unless `inventory` is off — open the inventory, under the
 * organization the lab's sessions run in.
 *
 * Opening the mailbox here rather than leaving it to the driver is what lets
 * the inventory follow it: a mailbox registers from its own open session. The
 * driver still calls `openMailboxes`, which meets this session and leaves it
 * as it is.
 *
 * @throws Naming every problem `openInventory` reported. A half-registered
 *   organization is not served, because a check graded on half of one proves
 *   nothing.
 */
export async function openLab(
  server: LabServer,
  options: { tree: LabTree; flows: Record<string, FlowInstance>; inventory: boolean },
): Promise<void> {
  const { tree, flows } = options;
  const router = (await server.getRouter()) as Record<string, (request: Request, context: unknown) => Promise<Response>>;

  // The session route, over this process's own router: the server is the
  // app, so a loopback hands the request straight to the handler.
  const call = async (method: "GET" | "POST" | "DELETE", path: string[], body?: unknown) => {
    const url = `http://multi-seat-collab.local/api/flows/${path.map(encodeURIComponent).join("/")}`;
    const response = await router[method]!(
      new Request(url, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } },
    );
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
  };
  const client: OpenMailboxesOptions["client"] = {
    createSession: async (create) => {
      const { status, body } = await call("POST", [create.flowKind, "sessions"], create);
      if (status >= 400) {
        throw Object.assign(new Error(`create session ${create.sessionId}: ${status} ${JSON.stringify(body)}`), {
          status,
        });
      }
      return body;
    },
    getSession: async (sessionId) => {
      const { status, body } = await call("GET", ["sessions", sessionId]);
      if (status >= 400) throw new Error(`read session ${sessionId}: ${status}`);
      return body?.session ?? body;
    },
    deleteSession: async (sessionId) => {
      await call("DELETE", ["sessions", sessionId]);
    },
  };
  await openMailboxes([tree.mailbox], { client, userId: LAB_USER_ID });
  if (!options.inventory) return;

  const runtime = await server.getRuntime();
  const run = async (request: InventoryActionRequest): Promise<unknown> => {
    const flow = flows[request.flowKind];
    if (flow === undefined) throw new Error(`no flow is served under "${request.flowKind}"`);
    const result = (await runAction({
      flow,
      actionName: request.action,
      input: request.input,
      userId: request.userId,
      orgId: request.orgId,
      sessionId: request.sessionId,
      source: request.source,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    } as never)) as { error?: unknown };
    if (result?.error !== undefined) {
      throw result.error instanceof Error ? result.error : new Error(String(result.error));
    }
    return result;
  };
  // Each seat, on the copy of the flow it runs on, whose actions its door is read from.
  const seats = tree.roster.workers.map((worker) => {
    const kind = tree.seatFlows[worker.id]!;
    const flow = flows[kind];
    if (flow === undefined) throw new Error(`seat "${worker.id}" runs on "${kind}", which is not registered`);
    return { id: worker.id, kind, actions: (flow as { actions?: Readonly<Record<string, unknown>> }).actions ?? {} };
  });
  const binding = await openInventory(
    { seats, mailboxes: [tree.mailbox] },
    { run, seatWriter: { flowKind: MAILBOX_KIND }, userId: LAB_USER_ID, orgId: LAB_ORG_ID },
  );
  if (binding.problems.length > 0) {
    throw new Error(
      `the lab's inventory did not register, so the lab will not serve:\n  - ${binding.problems.join("\n  - ")}`,
    );
  }
}
