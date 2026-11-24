// FIX-2770.
/**
 * `sessions.userSuspensions`, the request host's read of the running
 * principal's pending asks, against a store that records what it is asked.
 *
 * Why it matters: the read is an Inbox. Its scope must be the running
 * request's identity, never a block's input, with the tenant and organization
 * keys always present so an unbound principal can't widen it. The flow list
 * is the only width a block chooses, so it is bounded: none reads nothing, and
 * more than 50 is refused rather than quietly read. Paging must neither stall
 * on rows the instance's own sign-in drops nor skip the rows after them.
 */
import { describe, expect, it } from "vitest";
import type { FlowInstance, PendingUserSuspension, PendingUserSuspensionQuery } from "@flow-state-dev/core/types";
import { createRequestSessions, type RequestSessionsInputs } from "../src/context/request-sessions";
import { FlowStateConfigError } from "../src/errors/flow-error";
import type { SessionRecord } from "../src/stores/types";

const NOW = 1_800_000_000_000;

function entry(at: number, over: Partial<PendingUserSuspension> = {}): PendingUserSuspension {
  return {
    suspensionId: `s${String(at).padStart(4, "0")}`,
    requestId: `r${at}`,
    flowKind: "worker",
    flowId: "worker",
    kind: "input",
    shape: "question",
    message: "?",
    createdAt: NOW - 100_000 + at,
    ...over
  };
}

/** A store holding `rows`, ordered, answering the query's window, and recording each query. */
function store(entries: PendingUserSuspension[]) {
  const calls: PendingUserSuspensionQuery[] = [];
  return {
    calls,
    listPendingForUser: async (query: PendingUserSuspensionQuery) => {
      calls.push(query);
      const after = query.after;
      return entries
        .filter((r) => after === undefined || [r.createdAt - after.createdAt, r.requestId.localeCompare(after.requestId), r.suspensionId.localeCompare(after.suspensionId)].find((d) => d !== 0)! > 0)
        .slice(0, query.limit);
    }
  };
}

const sessionRecord = (id: string): SessionRecord =>
  ({ id, flowKind: "worker", flowId: "worker", userId: "alice", orgId: "acme", state: {}, version: 0, createdAt: 1, updatedAt: 1, journal: [], lineageId: `lin_${id}` }) as SessionRecord;

function sessions(
  entries: PendingUserSuspension[],
  over: Partial<RequestSessionsInputs> = {},
  identity: RequestSessionsInputs["identity"] = { userId: "alice", tenantId: undefined, orgId: "acme" }
) {
  const suspensions = store(entries);
  const read = createRequestSessions({
    sessions: { get: async (id: string) => sessionRecord(id), list: async () => [] },
    suspensions,
    now: () => NOW,
    identity,
    flow: { id: "roster", kind: "roster" } as unknown as FlowInstance,
    ...over
  });
  return { read, calls: suspensions.calls };
}

describe("sessions.userSuspensions: the scope", () => {
  it("reads the running request's identity, with tenantId and orgId always present, never the query's", async () => {
    const { read, calls } = sessions([entry(1)]);
    // A block that tries to name someone else is not heard.
    await read.userSuspensions({ flowKinds: ["worker"], userId: "mallory", orgId: "evil", tenantId: "t9" } as never);
    expect(calls).toHaveLength(1);
    const query = calls[0]!;
    expect(query.userId).toBe("alice");
    expect(query.orgId).toBe("acme");
    expect(Object.prototype.hasOwnProperty.call(query, "tenantId")).toBe(true);
    expect(query.tenantId).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(query, "orgId")).toBe(true);
    expect(query.flowKinds).toEqual(["worker"]);
    expect(query.now).toBe(NOW);
  });

  it("answers an empty flow list with nothing, and asks the store nothing", async () => {
    const { read, calls } = sessions([entry(1)]);
    expect(await read.userSuspensions({ flowKinds: [] })).toEqual({ suspensions: [], more: false });
    expect(calls).toHaveLength(0);
  });

  it("refuses more than 50 flow kinds with a config error naming the limit, and asks the store nothing", async () => {
    const { read, calls } = sessions([entry(1)]);
    const kinds = Array.from({ length: 51 }, (_, at) => `k${at}`);
    await expect(read.userSuspensions({ flowKinds: kinds })).rejects.toThrow(FlowStateConfigError);
    await expect(read.userSuspensions({ flowKinds: kinds })).rejects.toThrow(/50/);
    expect(calls).toHaveLength(0);
    // 50 is read.
    await read.userSuspensions({ flowKinds: kinds.slice(0, 50) });
    expect(calls).toHaveLength(1);
  });
});

describe("sessions.userSuspensions: a host with no suspension store", () => {
  it("refuses with a config error, as an overlong flow list does, rather than answering nothing", async () => {
    const { read } = sessions([], { suspensions: undefined });
    await expect(read.userSuspensions({ flowKinds: ["worker"] })).rejects.toThrow(FlowStateConfigError);
  });
});

describe("sessions.userSuspensions: paging", () => {
  it("answers exactly 200 rows with more: false and no next", async () => {
    const entries = Array.from({ length: 200 }, (_, at) => entry(at));
    const page = await sessions(entries).read.userSuspensions({ flowKinds: ["worker"] });
    expect(page.suspensions).toHaveLength(200);
    expect(page.more).toBe(false);
    expect("next" in page).toBe(false);
  });

  it("answers 201 rows with more: true and a next that reads the last one", async () => {
    const entries = Array.from({ length: 201 }, (_, at) => entry(at));
    const { read } = sessions(entries);
    const page = await read.userSuspensions({ flowKinds: ["worker"] });
    expect(page.suspensions).toHaveLength(200);
    expect(page.more).toBe(true);
    expect(page.next).toEqual({ createdAt: entries[199]!.createdAt, requestId: entries[199]!.requestId, suspensionId: entries[199]!.suspensionId });
    const rest = await read.userSuspensions({ flowKinds: ["worker"], after: page.next! });
    expect(rest.suspensions.map((r) => r.suspensionId)).toEqual([entries[200]!.suspensionId]);
    expect(rest.more).toBe(false);
  });
});

describe("sessions.userSuspensions: the instance's own credential check", () => {
  it("drops a row the check refuses, sessionless or not, judged with the principal's user and organization", async () => {
    const judged: unknown[] = [];
    const { read } = sessions([entry(1), entry(2, { sessionId: "sess_2" }), entry(3, { flowKind: "guarded" }), entry(4, { flowKind: "guarded", sessionId: "sess_4" })], {
      admitSuspension: async (candidate) => {
        judged.push(candidate);
        return candidate.flowKind !== "guarded";
      }
    });
    const page = await read.userSuspensions({ flowKinds: ["worker", "guarded"] });
    expect(page.suspensions.map((r) => r.suspensionId)).toEqual(["s0001", "s0002"]);
    expect(judged).toContainEqual({ flowKind: "guarded", flowId: "worker", userId: "alice", orgId: "acme" });
    expect(judged).toContainEqual({ flowKind: "guarded", flowId: "worker", sessionId: "sess_4", userId: "alice", orgId: "acme" });
  });

  it("applies the session admission on top for a row with a session", async () => {
    const { read } = sessions([entry(1), entry(2, { sessionId: "sess_refused" }), entry(3, { sessionId: "sess_ok" })], {
      admit: async (session) => session.id !== "sess_refused"
    });
    const page = await read.userSuspensions({ flowKinds: ["worker"] });
    expect(page.suspensions.map((r) => r.suspensionId)).toEqual(["s0001", "s0003"]);
  });

  it("pages past dropped rows: more stays true with fewer rows, and next reads on to the rows after them", async () => {
    // Rows 150..200 are refused; 201..210 are not.
    const entries = Array.from({ length: 211 }, (_, at) => entry(at, at >= 150 && at <= 200 ? { flowKind: "guarded" } : {}));
    const { read } = sessions(entries, { admitSuspension: async (candidate) => candidate.flowKind !== "guarded" });
    const page = await read.userSuspensions({ flowKinds: ["worker", "guarded"] });
    expect(page.suspensions).toHaveLength(150);
    expect(page.more).toBe(true);
    expect(page.next).toEqual({ createdAt: entries[199]!.createdAt, requestId: entries[199]!.requestId, suspensionId: entries[199]!.suspensionId });
    const rest = await read.userSuspensions({ flowKinds: ["worker", "guarded"], after: page.next! });
    expect(rest.suspensions.map((r) => r.suspensionId)).toEqual(entries.slice(201).map((r) => r.suspensionId));
    expect(rest.more).toBe(false);
  });
});
