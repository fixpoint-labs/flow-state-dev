/**
 * The driver — spawn the shipped `fsdev dev` on this lab's config, and drive
 * the scenario over the server's own HTTP doors.
 *
 * One module, so the headless legs and the browser leg drive **the same run**.
 * It reports raw observations and grades nothing: the grading is the goal's.
 *
 * Every door used here is one a person or an app already has — the session
 * route to open the channel (through the workforce package's own
 * `openChannels`), the action route to file, drain and answer, and the
 * DevTool's own debug read for the ledger. Nothing is written into a store by
 * hand, and nothing runs in this process that the server does not.
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
import { openChannels } from "@flow-state-dev/workforce";
import { REPO_ROOT, intentFreeEnv } from "../../lib/index.mts";
import { LAB_USER_ID, type LabTree } from "./host.mts";
import { FILE_ENTRY, type FileInput } from "./workforce/flows/workers/planner.mts";
import {
  ANSWER_ENTRY,
  DRAIN_ENTRY,
  workLineSchema,
  type WorkLine,
} from "./workforce/flows/workers/worker.mts";

/** The config `fsdev dev` is pointed at. */
export const LAB_CONFIG = join(REPO_ROOT, "goals", "multi-seat-collab", "lab", "fsdev.config.mts");

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
  // while our child died on EADDRINUSE. The exit watch closes the same hole.
  const port = 4300 + Math.floor(Math.random() * 600);
  const origin = `http://127.0.0.1:${port}`;

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
        MULTI_SEAT_COLLAB_OUTBOX: outbox,
        ...(options.debugEndpoints === false ? { FSDEV_DEBUG_ENDPOINTS: "0" } : {}),
      }),
      stdio: ["ignore", "pipe", "pipe"],
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
          stop: () => {
            child.kill("SIGTERM");
          },
          exited: () => exitedPromise,
        };
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGTERM");
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
  /** `claimed`, `review_requested`, `resumed`, `completed`, … */
  kind: string;
  taskId: string;
  /** The session the emitting request ran in. */
  sessionId: string;
  /** The flow instance that owns that session. */
  flowId: string;
  /** The principal the emitting request ran as. */
  userId: string;
  /** The action the emitting request ran. */
  action: string;
  requestId: string;
}

/**
 * Drive one served lab.
 *
 * The seat drain sessions are named once, here, so the browser leg can open
 * the very session the headless legs drained in.
 */
export class Scenario {
  constructor(
    readonly served: ServedLab,
    readonly tree: LabTree,
  ) {}

  private get api(): string {
    return `${this.served.origin}/api/flows`;
  }

  /** The session each seat works in. One spelling, used everywhere. */
  seatSession(seatId: string): string {
    return `s_${seatId.replace(/[^a-zA-Z0-9]/g, "_")}`;
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
   * Open the channel through the workforce package's own `openChannels`, over
   * the server's HTTP session route — the only route that takes a channel's
   * state at create — and create each seat's working session the same way.
   * The config's boot has already opened the channel; `openChannels` meets
   * that session and leaves it as it is.
   */
  async open(): Promise<void> {
    const client = {
      createSession: async (create: {
        flowKind: string;
        userId: string;
        sessionId?: string;
        description?: string;
        state?: Record<string, unknown>;
      }) => {
        const { status, body } = await this.json(`/${encodeURIComponent(create.flowKind)}/sessions`, {
          method: "POST",
          body: JSON.stringify(create),
        });
        if (status >= 400) {
          throw Object.assign(new Error(`create session ${create.sessionId}: ${status} ${JSON.stringify(body)}`), {
            status,
          });
        }
        return body;
      },
      getSession: async (sessionId: string) => {
        const { status, body } = await this.json(`/sessions/${encodeURIComponent(sessionId)}`);
        if (status >= 400) throw new Error(`read session ${sessionId}: ${status}`);
        return (body?.session ?? body) as {
          flowKind: string;
          flowId?: string;
          userId: string;
          state?: Record<string, unknown>;
        };
      },
      deleteSession: async (sessionId: string) => {
        await this.json(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      },
    };
    await openChannels([this.tree.channel], { client, userId: LAB_USER_ID });
    for (const seat of [this.tree.plannerId, ...this.tree.workerIds]) {
      await client.createSession({ flowKind: seat, userId: LAB_USER_ID, sessionId: this.seatSession(seat) });
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
    const items = (await this.requests(sessionId)).find((request) => request.id === requestId)?.items ?? [];
    return { httpStatus: posted.status, requestId, status, items };
  }

  /** The planner files one piece of work through its own action. */
  file(input: FileInput): Promise<ActResult> {
    return this.act(this.tree.plannerId, this.seatSession(this.tree.plannerId), FILE_ENTRY, input);
  }

  /**
   * Every worker seat drains at once. They share one board, and a drain exits
   * only when nothing on the board is claimable at all, so draining them one
   * after another would leave one idle-polling while another desk's row waited.
   */
  async drainAll(): Promise<Array<{ seat: string; result: ActResult; terminationReason?: string }>> {
    return Promise.all(
      this.tree.workerIds.map(async (seat) => {
        const result = await this.act(seat, this.seatSession(seat), DRAIN_ENTRY, {});
        return { seat, result, terminationReason: terminationReasonOf(result.items) };
      }),
    );
  }

  /**
   * A person answers a parked row through the owning seat's own action.
   *
   * @param settleWithinMs How long to wait for the request to settle. A
   *   delivery the server will not run may never settle at all (see the goal's
   *   second-principal leg), so the caller bounds the wait.
   */
  answer(
    seat: string,
    taskId: string,
    feedback: string,
    userId: string = LAB_USER_ID,
    settleWithinMs = 30_000,
  ): Promise<ActResult> {
    return this.act(seat, this.seatSession(seat), ANSWER_ENTRY, { taskId, feedback }, userId, settleWithinMs);
  }

  /**
   * Every row on the ledger, whole, through the DevTool's own debug read — the
   * read its Resources panel makes — on a worker seat's session, whose flow
   * declares the ledger.
   */
  async rows(): Promise<Array<Record<string, any>>> {
    const session = this.seatSession(this.tree.workerIds[0]!);
    const { status, body } = await this.json(
      `/sessions/${encodeURIComponent(session)}/debug/resources/${encodeURIComponent(this.tree.boardId)}/items?limit=200`,
    );
    if (status !== 200) throw new Error(`ledger read: ${status} ${JSON.stringify(body)}`);
    const items = (body?.items ?? []) as Array<{ state?: Record<string, any> | null }>;
    return items.map((item) => item.state ?? {}).filter((row) => typeof row.id === "string");
  }

  /** Wait until the ledger holds a row matching `predicate`, or give up. */
  async waitForRow(predicate: (row: Record<string, any>) => boolean, ms = 10_000): Promise<Record<string, any> | undefined> {
    for (let waited = 0; waited < ms; waited += 50) {
      const found = (await this.rows()).find(predicate);
      if (found !== undefined) return found;
      await new Promise((r) => setTimeout(r, 50));
    }
    return undefined;
  }

  /** Every session the server holds for the lab's user, dispatch runs included. */
  async sessions(): Promise<Array<Record<string, any>>> {
    const { body } = await this.json(`/sessions?include=dispatch-runs&userId=${encodeURIComponent(LAB_USER_ID)}&limit=500`);
    return (body?.sessions ?? []) as Array<Record<string, any>>;
  }

  /** One session's requests, with their items. */
  async requests(sessionId: string): Promise<Array<Record<string, any>>> {
    const { body } = await this.json(`/sessions/${encodeURIComponent(sessionId)}/requests?include_items=true&limit=500`);
    return (body?.requests ?? []) as Array<Record<string, any>>;
  }

  /**
   * Every task change the run emitted, anywhere, with the session, owner,
   * principal and action of the request that emitted it. A change is emitted
   * into the session that made it, so for a claim this is the claim's identity
   * as the server recorded it.
   */
  async changes(): Promise<ChangeRecord[]> {
    const out: ChangeRecord[] = [];
    for (const session of await this.sessions()) {
      for (const request of await this.requests(String(session.id))) {
        for (const change of taskChangesOf(request.items ?? [])) {
          out.push({
            kind: change.kind,
            taskId: change.taskId,
            sessionId: String(session.id),
            flowId: String(session.flowId ?? session.flowKind),
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

/**
 * What an action returned, as its own request recorded it.
 *
 * The HTTP action route acknowledges with a request id and carries no output,
 * so the value is read where the server records it: the request's root block
 * trace — the same record the DevTool's Trace tab renders. A root that
 * forwards a step's value records a `ref` to that step's item; this follows it.
 *
 * @returns The value, or `undefined` when the request recorded no root output.
 */
export function actionOutputOf(requestId: string, items: ReadonlyArray<Record<string, any>>): unknown {
  const byId = new Map(items.map((item) => [String(item.id), item]));
  const valueOf = (output: unknown, depth = 0): unknown => {
    const recorded = output as { kind?: string; value?: unknown; sourceItemId?: string } | undefined;
    if (recorded?.kind === "inline") return recorded.value;
    if (recorded?.kind === "ref" && depth < 8) {
      return valueOf(byId.get(String(recorded.sourceItemId))?.output, depth + 1);
    }
    return undefined;
  };
  const root = items.find(
    (item) => item.type === "block_trace" && item.blockInstanceId === `${requestId}:root:0`,
  );
  return valueOf(root?.output);
}

/** The drain's own termination reason, off its board-meta item. */
export function terminationReasonOf(items: ReadonlyArray<Record<string, any>>): string | undefined {
  const metas = items.filter((item) => item.type === "component" && item.component === "task-board-meta");
  const last = metas.at(-1)?.data as { terminationReason?: string } | undefined;
  return last?.terminationReason;
}
