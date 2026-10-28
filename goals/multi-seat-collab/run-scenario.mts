/**
 * The driver — spawn the shipped `fsdev dev` on this lab's config, and drive
 * the scenario over the server's own HTTP doors.
 *
 * One module, so the headless legs and the browser leg drive **the same run**.
 * It reports raw observations and grades nothing: the grading is the goal's.
 *
 * Every door used here is one a person or an app already has — the session
 * route to open each worker's session, and the action route on the planner's
 * conversation to file (`createTask_tasks`), and to answer a row's question and
 * reassign a row before it starts (`updateTask_tasks`). What the board holds is read off the
 * server's SQLite file, read-only: the session route sends a browser only a
 * row's board fields, and the checks grade a row's input and answer too.
 * Nothing is written into a store by hand, and nothing runs in this process
 * that the server does not.
 *
 * ## The environment the server gets
 *
 * Stripped of the intent-ladder overrides, through `goals/lib/env`'s
 * `intentFreeEnv`, exactly as every other goal does. `FSDEV_DEFAULT_MODEL` set
 * while no flow declares an intent makes the model resolver throw, and on the
 * served path that throw becomes a request that never advances and never
 * errors — on a flow with no model in it at all. Inherit it and the run
 * measures the machine (FIX-1511).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKER_ID_STATE_KEY } from "@flow-state-dev/workforce";
import { REPO_ROOT, intentFreeEnv, refuseIfAnswering, stopProcessGroup } from "../lib/index.mts";
import { allTaskRows, requests as storedRequests, type StoredTask } from "../coordinators/files-tasks-down-the-owners-chain/store.mts";
import { LAB_DB_PATH, LAB_USER_ID, type LabTree } from "../../packages/shift-manager/test/fixtures/multi-worker-collab/host.mts";
import type { PieceInput } from "../../packages/shift-manager/test/fixtures/multi-worker-collab/workforce/flows/piece.mts";
import { workLineSchema, type WorkLine } from "../../packages/shift-manager/test/fixtures/multi-worker-collab/workforce/flows/workers/worker.mts";

/** The config `fsdev dev` is pointed at. */
export const LAB_CONFIG = join(REPO_ROOT, "packages", "shift-manager", "test", "fixtures", "multi-worker-collab", "fsdev.config.mts");

/** What a served lab hands back. */
export interface ServedLab {
  origin: string;
  /** The server's working directory — where its SQLite file lives. */
  workDir: string;
  /** The file each attempt appends its line to. */
  outbox: string;
  /** Everything the server has printed so far. */
  log(): string;
  stop(): void;
  /** Resolves once the server process has exited — after `stop()`, before booting again over its database. */
  exited(): Promise<void>;
}

/**
 * Spawn `fsdev dev --config <lab>` in a scratch working directory and wait for
 * **our** server — not for whichever process answers on the port.
 *
 * @param options.control The `GOAL_CONTROL` the server's config reads, or `""`.
 * @param options.workDir The server's working directory; its SQLite file goes
 *   here. Pass the same one twice to boot a second time over the same database.
 * @param options.debugEndpoints `false` serves with `FSDEV_DEBUG_ENDPOINTS=0`.
 *   Left out, `fsdev dev`'s own default (on) holds.
 * @throws If the server exits before it is ready, naming the DevTool build when
 *   that is why.
 */
export async function serveLab(options: {
  control: string;
  workDir: string;
  debugEndpoints?: boolean;
}): Promise<ServedLab> {
  mkdirSync(options.workDir, { recursive: true });
  const outbox = join(options.workDir, "work.ndjson");
  writeFileSync(outbox, "", "utf8");
  // Never a fixed port: an incumbent on it would answer the readiness probe
  // while our child died on EADDRINUSE. A random port can still land on one,
  // so the pre-flight refuses it; the exit watch below closes the same hole.
  const port = 4300 + Math.floor(Math.random() * 600);
  const origin = `http://127.0.0.1:${port}`;
  await refuseIfAnswering(origin);

  let log = "";
  let exited: string | undefined;
  const child: ChildProcess = spawn(
    join(REPO_ROOT, "node_modules", ".bin", "tsx"),
    [
      join(REPO_ROOT, "packages", "cli", "bin", "fsdev.ts"),
      "dev",
      "--config",
      LAB_CONFIG,
      "--no-open",
      "--port",
      String(port),
    ],
    {
      cwd: options.workDir,
      env: intentFreeEnv(process.env, {
        GOAL_CONTROL: options.control,
        MULTI_WORKER_COLLAB_OUTBOX: outbox,
        ...(options.debugEndpoints === false ? { FSDEV_DEBUG_ENDPOINTS: "0" } : {}),
      }),
      stdio: ["ignore", "pipe", "pipe"],
      // Detached, so `stop` reaches the whole group, not only the `tsx` wrapper.
      detached: true,
    },
  );
  child.stdout?.on("data", (chunk) => (log += String(chunk)));
  child.stderr?.on("data", (chunk) => (log += String(chunk)));
  const exitedPromise = new Promise<void>((resolve) =>
    child.on("exit", (code, signal) => {
      exited = `code ${code}, signal ${signal}`;
      resolve();
    }),
  );

  for (let i = 0; i < 240; i += 1) {
    if (exited !== undefined) break;
    try {
      if ((await fetch(`${origin}/healthz`)).status === 200 && exited === undefined) {
        return {
          origin,
          workDir: options.workDir,
          outbox,
          log: () => log,
          stop: () => stopProcessGroup(child),
          exited: () => exitedPromise,
        };
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  stopProcessGroup(child);
  if (log.includes("DevTool assets not found")) {
    throw new Error(
      "the DevTool bundle is not built, so `fsdev dev` refused to start. Build it once:\n" +
        "  pnpm --filter @flow-state-dev/devtool build\n" +
        "  pnpm --filter @flow-state-dev/devtool build:assets",
    );
  }
  throw new Error(
    `the dev server ${exited === undefined ? "never became ready" : `exited before it was ready (${exited})`} ` +
      `on ${origin}. Log tail:\n${log.slice(-2000)}`,
  );
}

/** One request, as the server recorded it. */
export interface ActResult {
  /** The HTTP status of the POST itself. */
  httpStatus: number;
  /** The POST's body when it was not a 202. */
  refusal?: string;
  requestId?: string;
  /** The request's terminal status, as the status route reports it. */
  status?: string;
  /** What the action answered, as the session's request list records it. */
  output?: any;
  /** Every item the request persisted. */
  items: Array<Record<string, unknown>>;
}

/** A `task-change` component item, flattened to what the checks read. */
export interface TaskChange {
  kind: string;
  taskId: string;
  collectionId: string;
  task: Record<string, unknown>;
}

/** One task change the run emitted, and the request it was emitted from. */
export interface ChangeRecord {
  /** `added`, `claimed`, `review_requested`, `resumed`, `completed`, … */
  kind: string;
  taskId: string;
  /** The session the emitting request ran in. */
  sessionId: string;
  /** The worker that session names in its state (`workerId`), or `null` when it names none. */
  workerId: string | null;
  /** The principal the emitting request ran as. */
  userId: string;
  /** The action the emitting request ran. */
  action: string;
  requestId: string;
}

/** A row as the board stored it: the fields the checks read beyond the stored task's own. */
export type BoardRow = StoredTask & {
  input?: PieceInput;
  feedback?: string;
  holds?: { id: string; source: { kind: string }; ask: { kind: string; prompt: string } }[];
  steers?: { id: string; message: string; answers?: string }[];
  deps?: string[];
  startedAt?: number;
};

/** What one piece of work is, as a filer hands it to {@link Scenario.file}. */
export interface Piece {
  goal: string;
  /** The desk the piece is for, or none: a row for nobody. */
  desk?: string;
  asks?: string;
  /** The row this one follows, which it also waits on. */
  follows?: string;
  maxAttempts?: number;
}

/**
 * Drive one served lab.
 *
 * The planner's conversation and each worker's own session are named once,
 * here, so the browser leg can open the very session the headless legs used.
 */
export class Scenario {
  constructor(
    readonly served: ServedLab,
    readonly tree: LabTree,
    /** Desk -> delegate: the app's map the filer reads (`routesFor`). */
    readonly routes: Readonly<Record<string, string>>,
  ) {}

  private get api(): string {
    return `${this.served.origin}/api/flows`;
  }

  /** The session each worker works in — for the planner, its conversation. One spelling, used everywhere. */
  seatSession(workerId: string): string {
    return `s_${workerId.replace(/[^a-zA-Z0-9]/g, "_")}`;
  }

  /** The planner's conversation, whose board every row is filed on. */
  get conversation(): string {
    return this.seatSession(this.tree.plannerId);
  }

  /** The SQLite file the server writes. */
  get storeFile(): string {
    return join(this.served.workDir, LAB_DB_PATH);
  }

  private async json(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
    const response = await fetch(`${this.api}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text.length === 0 ? null : JSON.parse(text);
    } catch {
      /* not JSON — keep the text */
    }
    return { status: response.status, body };
  }

  /**
   * Open each worker's own session over the server's HTTP session route, on
   * the one copy of the flow it runs on, naming the worker. The planner's is
   * its conversation.
   */
  async open(): Promise<void> {
    for (const worker of this.tree.roster.workers.map((record) => record.id)) {
      const { status, body } = await this.json(`/${encodeURIComponent(this.tree.workerFlows[worker]!)}/sessions`, {
        method: "POST",
        body: JSON.stringify({ userId: LAB_USER_ID, sessionId: this.seatSession(worker), state: { [WORKER_ID_STATE_KEY]: worker } }),
      });
      if (status >= 400) throw new Error(`create session ${this.seatSession(worker)}: ${status} ${JSON.stringify(body)}`);
    }
  }

  /**
   * POST one action and wait for the request to settle.
   *
   * The action route acknowledges with a 202 and a request id; the result is
   * read back through the status route and the session's request list, the
   * same reads the DevTool makes.
   */
  async act(
    flowId: string,
    sessionId: string,
    action: string,
    input: unknown,
    userId: string = LAB_USER_ID,
    settleWithinMs = 30_000,
  ): Promise<ActResult> {
    const posted = await this.json(
      `/${encodeURIComponent(flowId)}/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(action)}`,
      { method: "POST", body: JSON.stringify({ userId, input }) },
    );
    if (posted.status !== 202) {
      return { httpStatus: posted.status, refusal: JSON.stringify(posted.body), items: [] };
    }
    const requestId = String(posted.body?.request?.id);
    let status = "in_progress";
    for (let waited = 0; waited < settleWithinMs && status === "in_progress"; waited += 50) {
      await new Promise((r) => setTimeout(r, 50));
      const read = await this.json(`/${encodeURIComponent(flowId)}/requests/${encodeURIComponent(requestId)}/status`);
      status = String(read.body?.status ?? "in_progress");
    }
    const found = (await this.requests(sessionId)).find((request) => request.id === requestId);
    return { httpStatus: posted.status, requestId, status, output: found?.result?.output, items: found?.items ?? [] };
  }

  /** Run one of the planner's conversation's actions. */
  onConversation(action: string, input: unknown, userId: string = LAB_USER_ID, settleWithinMs = 30_000): Promise<ActResult> {
    return this.act(this.tree.workerFlows[this.tree.plannerId]!, this.conversation, action, input, userId, settleWithinMs);
  }

  /**
   * File one piece on the planner's conversation's board, for the delegate
   * the app's map routes the piece's desk to, through its own
   * `createTask_tasks`, so it starts now. A piece with no desk is filed
   * for nobody through `createTask_tasks`, and starts nowhere. A piece that
   * follows another waits on it.
   */
  file(piece: Piece): Promise<ActResult> {
    const input: PieceInput = {
      ...(piece.desk === undefined ? {} : { desk: piece.desk }),
      ...(piece.asks === undefined ? {} : { asks: piece.asks }),
      ...(piece.follows === undefined ? {} : { follows: piece.follows }),
    };
    return this.onConversation(piece.desk === undefined ? "createTask_tasks" : "createTask_tasks", {
      goal: piece.goal,
      ...(piece.desk === undefined ? {} : { assignee: this.routes[piece.desk] }),
      ...(piece.follows === undefined ? {} : { deps: [piece.follows] }),
      ...(piece.maxAttempts === undefined ? {} : { maxAttempts: piece.maxAttempts }),
      input,
    });
  }

  /**
   * A person answers a row held on its worker's question, through the
   * planner's conversation's `updateTask_tasks`, naming the question: the
   * row's open one, else the last it asked, so a second answer names the
   * question the first one closed.
   *
   * @param settleWithinMs How long to wait for the request to settle. A
   *   delivery the server will not run may never settle at all, so the caller
   *   bounds the wait.
   */
  answer(taskId: string, answer: string, userId: string = LAB_USER_ID, settleWithinMs = 30_000): Promise<ActResult> {
    const questions = (this.rows().find((row) => row.id === taskId)?.holds ?? []).filter((hold) => hold.source.kind === "row");
    const answeredIds = new Set((this.rows().find((row) => row.id === taskId)?.steers ?? []).flatMap((steer) => (steer.answers === undefined ? [] : [steer.answers])));
    const question = questions.find((hold) => !answeredIds.has(hold.id)) ?? questions[questions.length - 1];
    return this.onConversation("updateTask_tasks", { id: taskId, question: question?.id ?? "none", message: answer }, userId, settleWithinMs);
  }

  /** Every row the lab user's conversations filed, read off the server's store. */
  rows(): BoardRow[] {
    if (!existsSync(this.storeFile)) return [];
    return allTaskRows(this.storeFile).filter((row) => row.scopeId.startsWith(`${LAB_USER_ID}:`) || row.scopeId === LAB_USER_ID) as BoardRow[];
  }

  /** Wait until the board holds a row matching `predicate`, or give up. */
  async waitForRow(predicate: (row: BoardRow) => boolean, ms = 10_000): Promise<BoardRow | undefined> {
    for (let waited = 0; waited < ms; waited += 50) {
      const found = this.rows().find(predicate);
      if (found !== undefined) return found;
      await new Promise((r) => setTimeout(r, 50));
    }
    return undefined;
  }

  /** Wait until no request is running, then a beat more, so a dispatch accepted just now is counted. */
  async settled(ms = 30_000): Promise<boolean> {
    let calm = 0;
    for (let waited = 0; waited < ms; waited += 100) {
      calm = storedRequests(this.storeFile).some((request) => request.status === "in_progress") ? 0 : calm + 1;
      if (calm >= 5) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  /** Every session the server holds for the lab's user, dispatch runs included. */
  async sessions(): Promise<Array<Record<string, any>>> {
    const { body } = await this.json(`/sessions?include=dispatch-runs&userId=${encodeURIComponent(LAB_USER_ID)}&limit=500`);
    return (body?.sessions ?? []) as Array<Record<string, any>>;
  }

  /** One session's requests, with their items and answers. */
  async requests(sessionId: string): Promise<Array<Record<string, any>>> {
    const { body } = await this.json(
      `/sessions/${encodeURIComponent(sessionId)}/requests?include_items=true&include_result_output=true&limit=500`,
    );
    return (body?.requests ?? []) as Array<Record<string, any>>;
  }

  /**
   * Every task change the run emitted, anywhere, with the session (and the
   * worker it names), principal and action of the request that emitted it. A
   * change is emitted into the session that made it.
   */
  async changes(): Promise<ChangeRecord[]> {
    const out: ChangeRecord[] = [];
    for (const session of await this.sessions()) {
      const worker = session.state?.[WORKER_ID_STATE_KEY];
      for (const request of await this.requests(String(session.id))) {
        for (const change of taskChangesOf(request.items ?? [])) {
          out.push({
            kind: change.kind,
            taskId: change.taskId,
            sessionId: String(session.id),
            workerId: typeof worker === "string" ? worker : null,
            userId: String(request.userId),
            action: String(request.actionName),
            requestId: String(request.id),
          });
        }
      }
    }
    return out;
  }

  /** The lines the work left behind, outside the board entirely. */
  workLines(): WorkLine[] {
    if (!existsSync(this.served.outbox)) return [];
    return readFileSync(this.served.outbox, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => workLineSchema.parse(JSON.parse(line)));
  }
}

/** The `task-change` component items among a request's items. */
export function taskChangesOf(items: ReadonlyArray<Record<string, any>>): TaskChange[] {
  return items
    .filter((item) => item.type === "component" && item.component === "task-change")
    .map((item) => item.data as TaskChange)
    .filter((change) => change !== undefined && typeof change.taskId === "string");
}
