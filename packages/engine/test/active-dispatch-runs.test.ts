/**
 * `resolveActiveDispatchRuns` answers "which of these runs are unfinished" for
 * many runs at once, and must answer exactly as `resolveDispatchRunStatus`
 * does run by run: a session stream that opened on the batched answer and
 * then refreshed run by run would otherwise flip a run on and off.
 *
 * It exists for its cost, so the read count is asserted too: run by run, an
 * adapter with no index reads every request record per run.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import {
  createFilesystemStores,
  createInMemoryStores,
  type RequestRecord,
  type RequestStatus,
  type RequestStore
} from "../src";
import {
  resolveActiveDispatchRuns,
  resolveDispatchRunStatus,
  type ParentIdentity
} from "../src/routes/child-session-routes";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const adapters = [
  { name: "memory", create: async () => createInMemoryStores() },
  {
    name: "filesystem",
    create: async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-active-runs-"));
      tempDirs.push(rootDir);
      return createFilesystemStores({ rootDir });
    }
  }
];

const identity: ParentIdentity = { userId: "alice", orgId: DEFAULT_ORG_ID, tenantId: undefined };

/** Each run's history, oldest first. */
const histories: Record<string, RequestStatus[]> = {
  run_none: [],
  run_completed: ["completed"],
  run_failed: ["failed"],
  run_in_progress: ["in_progress"],
  run_suspended_then_completed: ["suspended", "completed"],
  run_interrupted: ["completed", "interrupted"],
  run_interrupted_then_retried: ["interrupted", "completed"],
  run_interrupted_twice_then_failed: ["interrupted", "interrupted", "failed"]
};

async function seed(store: RequestStore): Promise<void> {
  for (const [sessionId, statuses] of Object.entries(histories)) {
    for (const [index, status] of statuses.entries()) {
      const at = 1_000 + index * 1_000;
      const record: RequestRecord = {
        id: `${sessionId}_${index}`,
        flowKind: "chat",
        actionName: "run",
        userId: identity.userId,
        orgId: identity.orgId,
        sessionId,
        source: "http",
        status,
        startedAtMs: at,
        state: {},
        version: 0,
        createdAt: at,
        updatedAt: at
      };
      await store.set(record.id, record, "any");
    }
  }
}

function counting(store: RequestStore): { store: RequestStore; reads: () => number } {
  let reads = 0;
  const counted = new Proxy(store, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (key === "list") {
        return (...args: Parameters<RequestStore["list"]>) => {
          reads += 1;
          return target.list(...args);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { store: counted, reads: () => reads };
}

describe.each(adapters)("resolveActiveDispatchRuns — $name adapter", ({ create }) => {
  it("names as active exactly the runs the run-by-run resolve calls active", async () => {
    const { request } = await create();
    await seed(request);
    const ids = Object.keys(histories);

    const expected: string[] = [];
    for (const id of ids) {
      if ((await resolveDispatchRunStatus(request, id, identity)) === "active") expected.push(id);
    }

    expect([...(await resolveActiveDispatchRuns(request, ids, identity))].sort()).toEqual(
      expected.sort()
    );
    // The matrix has to hold both answers, or agreeing proves nothing.
    expect(expected.sort()).toEqual([
      "run_in_progress",
      "run_interrupted",
      "run_suspended_then_completed"
    ]);
  });

  it("reads twice however many runs, plus two per run with an interrupted record", async () => {
    const { request } = await create();
    await seed(request);
    const { store, reads } = counting(request);
    const noInterrupted = ["run_none", "run_completed", "run_failed", "run_suspended_then_completed"];

    await resolveActiveDispatchRuns(store, noInterrupted, identity);
    expect(reads()).toBe(2);

    const withInterrupted = counting(request);
    await resolveActiveDispatchRuns(withInterrupted.store, Object.keys(histories), identity);
    // Three runs hold an interrupted record; the one still in progress is
    // settled by the first read and never asked about.
    expect(withInterrupted.reads()).toBe(2 + 3 * 2);
  });

  it("does not count another owner's live run", async () => {
    const { request } = await create();
    await seed(request);

    const other = await resolveActiveDispatchRuns(
      request,
      Object.keys(histories),
      { ...identity, userId: "bob" }
    );
    expect([...other]).toEqual([]);
  });
});
