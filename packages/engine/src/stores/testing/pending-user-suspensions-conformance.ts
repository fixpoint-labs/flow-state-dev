// FIX-2770; FIX-2683 ER-6.
/**
 * Shared conformance for `SuspensionStore.listPendingForUser`. Every adapter
 * (memory, filesystem, SQLite, Postgres) runs it via
 * `@flow-state-dev/engine/testing`.
 *
 * The read is a user's Inbox, so each case is a row that must never reach
 * the wrong person or show something that waits on no one: the same user in
 * another tenant or organization, another user, a request with no
 * organization, another flow, a suspension whose request is gone, an expired
 * suspension, a wait gate, a raw `ctx.suspend` for an event, and an unbound
 * principal against a tenant-bound request. All scope sits in the store's
 * own query, so these hold per store, not in a filter the engine runs after.
 *
 * Beside those: each row carries exactly the projection's keys, never the
 * run's payload; a SQL store runs one statement that joins `requests`; and a
 * cursor inside a `createdAt` tie neither repeats nor skips a row, two
 * requests' suspensions sharing an id included.
 */
import { describe, expect, it } from "vitest";
import type { PendingUserSuspensionQuery, SuspensionRecord } from "@flow-state-dev/core/types";
import type { RequestRecord, RequestStore, SuspensionStore } from "../types";

/** One backend under test: its suspension store and the request store it joins to. */
export type PendingUserSuspensionsUnderTest = {
  suspensions: SuspensionStore;
  /** Where the suite writes the requests the suspensions join to. */
  requests: Pick<RequestStore, "set">;
  /**
   * SQL adapters only: every statement the suspension store runs is pushed
   * here, so the suite can check the read is one statement joining `requests`.
   */
  statements?: string[];
};

export type CreatePendingUserSuspensionsConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"SQLite"`. */
  name: string;
  /** Build a fresh, empty backend. Called per test. */
  createStore: () => PendingUserSuspensionsUnderTest | Promise<PendingUserSuspensionsUnderTest>;
  /** Optional teardown hook for backends with external resources. */
  cleanup?: (store: PendingUserSuspensionsUnderTest) => Promise<void> | void;
};

const NOW = 1_800_000_000_000;

/** Every key a projected row may carry; a row with all of them set carries exactly these. */
const PROJECTION_KEYS = [
  "allow",
  "createdAt",
  "expiresAt",
  "flowId",
  "flowKind",
  "kind",
  "message",
  "render",
  "requestId",
  "resumeSchema",
  "sessionId",
  "shape",
  "suspensionId",
  "title"
];

const ALICE = { userId: "alice", tenantId: "t1", orgId: "acme" } as const;

function query(over: Partial<PendingUserSuspensionQuery> = {}): PendingUserSuspensionQuery {
  return { userId: ALICE.userId, tenantId: ALICE.tenantId, orgId: ALICE.orgId, flowKinds: ["worker"], now: NOW, limit: 200, ...over };
}

type RequestScope = { userId: string; tenantId?: string; orgId?: string; flowKind: string; flowId?: string; sessionId?: string };

function requestRecord(id: string, scope: RequestScope): RequestRecord {
  return {
    id,
    state: {},
    version: 0,
    createdAt: NOW - 10_000,
    updatedAt: NOW - 10_000,
    flowKind: scope.flowKind,
    ...(scope.flowId !== undefined ? { flowId: scope.flowId } : {}),
    actionName: "respond",
    userId: scope.userId,
    ...(scope.sessionId !== undefined ? { sessionId: scope.sessionId } : {}),
    ...(scope.orgId !== undefined ? { orgId: scope.orgId } : {}),
    ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
    source: "http",
    status: "suspended",
    startedAtMs: NOW - 10_000
  };
}

function suspension(requestId: string, suspensionId: string, over: Partial<SuspensionRecord> = {}): SuspensionRecord {
  return {
    suspensionId,
    requestId,
    flowKind: "worker",
    flowId: "worker",
    actionName: "respond",
    userId: ALICE.userId,
    reason: "user_input",
    message: `stop ${suspensionId}`,
    status: "pending",
    blockInstanceId: "b1",
    stepIndex: 0,
    createdAt: NOW - 5_000,
    ...over
  };
}

/**
 * Seed one request and one suspension under it, unless `request` is `null`
 * (a suspension whose request is missing).
 */
async function seed(
  store: PendingUserSuspensionsUnderTest,
  id: string,
  request: RequestScope | null,
  over: Partial<SuspensionRecord> = {}
): Promise<void> {
  if (request !== null) {
    const result = await store.requests.set(id, requestRecord(id, request), "absent");
    if (!result.ok) throw new Error(`seeding request ${id} failed`);
  }
  await store.suspensions.set(suspension(id, `s_${id}`, over));
}

const WORKER: RequestScope = { ...ALICE, flowKind: "worker", flowId: "worker", sessionId: "sess_1" };

/**
 * Register the pending-suspensions conformance cases against a backend. Call inside a
 * test file's top-level scope.
 */
export function createPendingUserSuspensionsConformanceTests(
  options: CreatePendingUserSuspensionsConformanceTestsOptions
): void {
  const { name, createStore, cleanup } = options;

  async function withStore(fn: (store: PendingUserSuspensionsUnderTest) => Promise<void>): Promise<void> {
    const store = await createStore();
    try {
      await fn(store);
    } finally {
      if (cleanup !== undefined) await cleanup(store);
    }
  }

  const ids = async (store: PendingUserSuspensionsUnderTest, q: PendingUserSuspensionQuery = query()) =>
    (await store.suspensions.listPendingForUser(q)).map((row) => row.suspensionId);

  describe(`${name} (pending user suspensions conformance)`, () => {
    it("lists the caller's own pending suspensions, oldest first, and none of the rows that aren't theirs or don't wait on them", async () => {
      await withStore(async (store) => {
        await seed(store, "mine", WORKER, { createdAt: NOW - 3_000 });
        await seed(store, "sessionless", { ...ALICE, flowKind: "worker" }, { reason: "user_approval", createdAt: NOW - 2_000 });
        // A stop core 0.2.0 stored under its old name waits on a person too.
        await seed(store, "legacy", WORKER, { reason: "human_approval", createdAt: NOW - 1_000 }); // retired-name-refusal: a stop core 0.2.0 stored
        // ER-6's rows that must answer nothing.
        await seed(store, "other-tenant", { ...WORKER, tenantId: "t2" });
        await seed(store, "other-org", { ...WORKER, orgId: "globex" });
        await seed(store, "bobs", { ...WORKER, userId: "bob" }, { userId: "bob" });
        await seed(store, "null-org", { userId: "alice", tenantId: "t1", flowKind: "worker", sessionId: "sess_1" });
        await seed(store, "other-flow", { ...WORKER, flowKind: "other" }, { flowKind: "other" });
        await seed(store, "missing-request", null);
        await seed(store, "expired", WORKER, { expiresAt: NOW - 1 });
        await seed(store, "expires-now", WORKER, { expiresAt: NOW });
        await seed(store, "wait-gate", WORKER, { reason: "wait" });
        await seed(store, "event", WORKER, { reason: "external_event" });
        await seed(store, "answered", WORKER, { status: "approved", resolvedAt: NOW - 100 });

        expect(await ids(store)).toEqual(["s_mine", "s_sessionless", "s_legacy"]);
      });
    });

    it("keeps a suspension that has not expired yet", async () => {
      await withStore(async (store) => {
        await seed(store, "later", WORKER, { expiresAt: NOW + 1 });
        expect(await ids(store)).toEqual(["s_later"]);
      });
    });

    it("answers a principal with no tenant nothing of a tenant-bound request, and only its own unbound one", async () => {
      await withStore(async (store) => {
        await seed(store, "bound", WORKER);
        await seed(store, "unbound", { userId: "alice", orgId: "acme", flowKind: "worker", sessionId: "sess_2" }, { createdAt: NOW - 4_000 });
        expect(await ids(store, query({ tenantId: undefined }))).toEqual(["s_unbound"]);
      });
    });

    it("lists a sessionless suspension only through its request's scope", async () => {
      await withStore(async (store) => {
        await seed(store, "sessionless-mine", { ...ALICE, flowKind: "worker" });
        await seed(store, "sessionless-other-org", { ...ALICE, orgId: "globex", flowKind: "worker" });
        await seed(store, "sessionless-other-tenant", { ...ALICE, tenantId: "t2", flowKind: "worker" });
        const rows = await store.suspensions.listPendingForUser(query());
        expect(rows.map((row) => row.suspensionId)).toEqual(["s_sessionless-mine"]);
        expect("sessionId" in rows[0]!).toBe(false);
      });
    });

    it("reads the flow kinds named, and no other", async () => {
      await withStore(async (store) => {
        await seed(store, "w", WORKER, { createdAt: NOW - 3_000 });
        await seed(store, "o", { ...WORKER, flowKind: "other" }, { flowKind: "other", createdAt: NOW - 2_000 });
        await seed(store, "x", { ...WORKER, flowKind: "third" }, { flowKind: "third", createdAt: NOW - 1_000 });
        expect(await ids(store, query({ flowKinds: ["worker", "third"] }))).toEqual(["s_w", "s_x"]);
      });
    });

    it("projects exactly the declared keys, with no run payload, from a row that carries all of it", async () => {
      await withStore(async (store) => {
        await seed(store, "full", { ...WORKER, flowId: "worker-a" }, {
          flowId: "worker-b",
          kind: "input",
          title: "Pick one",
          allow: ["submit", "skip"],
          resumeSchema: { type: "string", enum: ["a", "b"] },
          render: { component: "picker", props: { dense: true } },
          expiresAt: NOW + 60_000,
          stepInput: { secret: "step" },
          resumeData: { secret: "resume" },
          data: { secret: "data" },
          resolvedBy: "nobody"
        });
        const rows = await store.suspensions.listPendingForUser(query());
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        expect(Object.keys(row).sort()).toEqual(PROJECTION_KEYS);
        expect(row).toEqual({
          suspensionId: "s_full",
          requestId: "full",
          flowKind: "worker",
          // The request's instance wins over the suspension's.
          flowId: "worker-a",
          sessionId: "sess_1",
          kind: "input",
          shape: "selection",
          title: "Pick one",
          message: "stop s_full",
          allow: ["submit", "skip"],
          resumeSchema: { type: "string", enum: ["a", "b"] },
          render: { component: "picker", props: { dense: true } },
          createdAt: NOW - 5_000,
          expiresAt: NOW + 60_000
        });
        expect(JSON.stringify(row)).not.toContain("secret");
      });
    });

    it("reads on from a cursor inside a createdAt tie with no row repeated or skipped", async () => {
      await withStore(async (store) => {
        for (const id of ["a", "b", "c", "d", "e"]) await seed(store, id, WORKER, { createdAt: NOW - 1_000 });
        await seed(store, "f", WORKER, { createdAt: NOW - 500 });
        const first = await store.suspensions.listPendingForUser(query({ limit: 2 }));
        expect(first.map((row) => row.suspensionId)).toEqual(["s_a", "s_b"]);
        const last = first.at(-1)!;
        const rest = await store.suspensions.listPendingForUser(
          query({ after: { createdAt: last.createdAt, requestId: last.requestId, suspensionId: last.suspensionId } })
        );
        expect(rest.map((row) => row.suspensionId)).toEqual(["s_c", "s_d", "s_e", "s_f"]);
      });
    });

    it("reads on past a page boundary that splits two requests' suspensions sharing an id and a createdAt", async () => {
      // A suspension's id is unique only within its request (the key is
      // `(requestId, suspensionId)`), so a cursor without the request would
      // skip the second of these.
      await withStore(async (store) => {
        await seed(store, "req-a", WORKER, { suspensionId: "s_same", createdAt: NOW - 1_000 });
        await seed(store, "req-b", WORKER, { suspensionId: "s_same", createdAt: NOW - 1_000 });
        const first = await store.suspensions.listPendingForUser(query({ limit: 1 }));
        expect(first.map((entry) => entry.requestId)).toEqual(["req-a"]);
        const last = first[0]!;
        const rest = await store.suspensions.listPendingForUser(
          query({ after: { createdAt: last.createdAt, requestId: last.requestId, suspensionId: last.suspensionId } })
        );
        expect(rest.map((entry) => `${entry.requestId}/${entry.suspensionId}`)).toEqual(["req-b/s_same"]);
      });
    });

    it("answers at most `limit` rows", async () => {
      await withStore(async (store) => {
        for (let at = 0; at < 5; at += 1) await seed(store, `r${at}`, WORKER, { createdAt: NOW - 1_000 + at });
        expect(await ids(store, query({ limit: 3 }))).toEqual(["s_r0", "s_r1", "s_r2"]);
      });
    });

    it("drops a suspension whose request is missing inside one statement that joins the requests", async () => {
      await withStore(async (store) => {
        await seed(store, "missing-request", null);
        await seed(store, "present", WORKER);
        store.statements?.splice(0);
        expect(await ids(store)).toEqual(["s_present"]);
        if (store.statements === undefined) return;
        expect(store.statements).toHaveLength(1);
        expect(store.statements[0]).toMatch(/\bJOIN\s+requests\b/i);
      });
    });
  });
}
