/**
 * POC for FIX-2426 — retained design evidence, not production code.
 *
 * The question (epic FIX-2367 D1's flip, and D6's premise): what does one open
 * `GET /sessions/:id/stream` connection cost the store today, per second, when
 * nothing in the session changes? D1 rejected widening the stream to user and
 * org scopes on the claim that this cost is "at least four reads per view per
 * second", multiplied by the scopes watched. D6 has the bus wake the read so an
 * idle view costs nothing. Both rest on the number; this measures it.
 *
 * What it does: the real engine router over the real Postgres stores (on
 * PGlite, so it runs anywhere), every SQL statement counted at the executor.
 * One session with finished history, then N viewers hold the stream open for
 * a fixed window at the shipped one-second interval. Reported per viewer per
 * second: SQL statements, and time spent inside the database. Two shapes:
 *
 *   idle    — nothing runs in the session; the case D6 makes free.
 *   active  — one request in progress and two background runs open, the case a
 *             board or a lab sits in while work runs.
 *
 * The negative control (`FIX2426_CONTROL=no-viewers`) opens no stream and must
 * report zero statements in the window, or the counter is counting something
 * other than the stream.
 *
 * Run with `bash specs/issues/FIX-2426/poc/stream-read-cost/run.sh`.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  disposeFlowApiRouter,
  type RequestRecord,
  type SessionRecord,
  type StoreRegistry
} from "@flow-state-dev/engine";
import { createPostgresStores, type QueryExecutor } from "../src";
import { freshPglite } from "./shared-pglite";

const WINDOW_MS = Number(process.env.FIX2426_WINDOW_MS ?? 10_000);
const VIEWERS = (process.env.FIX2426_VIEWERS ?? "1,10,50").split(",").map(Number);
const CONTROL = process.env.FIX2426_CONTROL;
const HISTORY = 200;

type Counter = { statements: number; dbMs: number; on: boolean };

function countingExecutor(pglite: PGlite, counter: Counter): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const started = performance.now();
      const result = await pglite.query(text, values);
      if (counter.on) {
        counter.statements += 1;
        counter.dbMs += performance.now() - started;
      }
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
}

function sessionRecord(id: string, now: number, parentSessionId?: string): SessionRecord {
  return {
    orgId: DEFAULT_ORG_ID,
    id,
    flowKind: "chat",
    userId: "alice",
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    journal: [],
    ...(parentSessionId !== undefined ? { parentSessionId } : {})
  } as SessionRecord;
}

function requestRecord(id: string, sessionId: string, status: string, at: number): RequestRecord {
  return {
    id,
    sessionId,
    flowKind: "chat",
    actionName: "say",
    userId: "alice",
    orgId: DEFAULT_ORG_ID,
    source: "http",
    status,
    startedAtMs: at,
    state: {},
    version: 0,
    createdAt: at,
    updatedAt: at,
    items: [
      {
        id: `m_${id}`,
        type: "message",
        status: "completed",
        requestId: id,
        itemIndex: 0,
        ts: at,
        role: "assistant",
        content: [{ type: "output_text", text: "hello" }],
        provenance: { blockName: "say", blockInstanceId: `${id}:root:0`, phase: "main" }
      }
    ]
  } as unknown as RequestRecord;
}

/** A session with `HISTORY` finished requests, an hour old; optionally work running now. */
async function seed(stores: StoreRegistry, active: boolean): Promise<void> {
  const old = Date.now() - 3_600_000;
  await stores.session.set("s1", sessionRecord("s1", old), "any");
  for (let i = 0; i < HISTORY; i++) {
    await stores.request.set(`req_${i}`, requestRecord(`req_${i}`, "s1", "completed", old + i), "any");
  }
  if (!active) return;
  const now = Date.now();
  await stores.request.set("req_live", requestRecord("req_live", "s1", "in_progress", now), "any");
  for (const child of ["run_a", "run_b"]) {
    await stores.session.set(child, sessionRecord(child, now, "s1"), "any");
    await stores.request.set(`${child}_req`, requestRecord(`${child}_req`, child, "in_progress", now), "any");
  }
}

type Row = { shape: string; viewers: number; perViewerPerSec: number; dbMsPerViewerPerSec: number; poolShare: string };
const rows: Row[] = [];

async function measure(shape: "idle" | "active", viewers: number): Promise<Row> {
  const counter: Counter = { statements: 0, dbMs: 0, on: false };
  const stores = await createPostgresStores({ executor: countingExecutor(await freshPglite(), counter) });
  await seed(stores, shape === "active");

  const registry = createFlowRegistry();
  registry.register(
    defineFlow({ kind: "chat", actions: { say: { block: handler({ name: "say", execute: () => ({}) }) } } })()
  );
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  const controllers: AbortController[] = [];
  const bodies: Promise<string>[] = [];
  try {
    const opening = CONTROL === "no-viewers" ? 0 : viewers;
    for (let v = 0; v < opening; v++) {
      const controller = new AbortController();
      controllers.push(controller);
      const res = await router.GET(
        new Request("http://localhost/api/flows/sessions/s1/stream", { signal: controller.signal }),
        { params: { path: ["sessions", "s1", "stream"] } }
      );
      expect(res.status).toBe(200);
      bodies.push(res.text());
    }
    // Let every connection finish its opening read, then count a steady window.
    await new Promise((r) => setTimeout(r, 1_500));
    counter.on = true;
    await new Promise((r) => setTimeout(r, WINDOW_MS));
    counter.on = false;
  } finally {
    for (const c of controllers) c.abort();
    const settled = await Promise.allSettled(bodies);
    await disposeFlowApiRouter(router);
    // The shape is what it claims: the active session's stream names its two open runs.
    const first = settled[0];
    if (first?.status === "fulfilled") {
      const runsFrame = first.value.split("\n\n").find((f) => f.includes("event: session.runs"));
      const data = runsFrame?.split("\n").find((l) => l.startsWith("data: "));
      const named = data === undefined ? -1 : (JSON.parse(data.slice(6)) as { runs: unknown[] }).runs.length;
      expect(named).toBe(shape === "active" ? 2 : 0);
    }
  }
  const seconds = WINDOW_MS / 1_000;
  const perViewerPerSec = viewers === 0 ? 0 : counter.statements / seconds / viewers;
  const dbMsPerViewerPerSec = viewers === 0 ? 0 : counter.dbMs / seconds / viewers;
  // Share of a 10-connection pool's time (10 000 connection-ms per second) the
  // stream's reads hold, at this viewer count.
  const poolShare = `${((counter.dbMs / seconds / 10_000) * 100).toFixed(1)}%`;
  return { shape, viewers, perViewerPerSec, dbMsPerViewerPerSec, poolShare };
}

describe("FIX-2426 POC · what an open session-stream view costs the store", () => {
  afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(
      `\nwindow ${WINDOW_MS} ms · history ${HISTORY} requests · control ${CONTROL ?? "none"}\n` +
        rows
          .map(
            (r) =>
              `${r.shape.padEnd(7)} viewers=${String(r.viewers).padStart(3)}  ` +
              `statements/viewer/s=${r.perViewerPerSec.toFixed(2).padStart(6)}  ` +
              `db-ms/viewer/s=${r.dbMsPerViewerPerSec.toFixed(2).padStart(7)}  pool(10)=${r.poolShare}`
          )
          .join("\n")
    );
  });

  for (const shape of ["idle", "active"] as const) {
    for (const viewers of VIEWERS) {
      it(`${shape} · ${viewers} viewer(s)`, async () => {
        const row = await measure(shape, viewers);
        rows.push(row);
        if (CONTROL === "no-viewers") {
          // Nobody watching: the counter must see nothing, or it measures something else.
          expect(row.perViewerPerSec).toBe(0);
        } else {
          // Today's claim: an idle view reads at least four times a second.
          expect(row.perViewerPerSec).toBeGreaterThanOrEqual(4);
        }
      }, WINDOW_MS * 3 + 30_000);
    }
  }
});
