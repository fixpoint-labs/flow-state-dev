/**
 * POC (throwaway — FIX-939 design, not a shipping test).
 *
 * Exercises the proposed sub-session model against the REAL in-memory stores:
 *
 *   - a sub-session carries `parentSessionId` + `topic`
 *   - tasks route to a workstream by (parentSessionId, flowKind, topic), get-or-create
 *   - lineage-derived affinity and key-based routing must converge on one session
 *
 * Specifically settles whether get-or-create is safe under concurrent dispatch.
 */
import { describe, expect, it } from "vitest";
import { InMemorySessionStore } from "../src/stores/memory/session-store";
import { InMemoryRequestStore } from "../src/stores/memory/request-store";
import type { RequestRecord, SessionRecord } from "../src/stores/types";

/** The two fields the design would add to SessionRecord. */
type Workstream = SessionRecord & {
  parentSessionId?: string;
  topic?: string;
};

/** Default flow for a Workstream in this POC; the parent uses `PARENT_FLOW`. */
const WORKER_FLOW = "worker";
const PARENT_FLOW = "epic";

function makeSession(
  id: string,
  parentSessionId?: string,
  topic?: string,
  flowKind: string = WORKER_FLOW
): Workstream {
  const ts = 1_000;
  return {
    id,
    flowKind,
    userId: "u1",
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: [],
    parentSessionId,
    topic
  };
}

/**
 * `SessionListOptions` has no `parentSessionId` or `topic` filter today
 * (flowKind / userId / tenantId / limit only), so the lookup scans and filters
 * in memory. That scan is exactly the filter the adapters would need.
 *
 * Keyed on `(parentSessionId, flowKind, topic)` — `SessionRecord.flowKind` binds
 * a session to a flow at creation, so topic alone can return a Workstream whose
 * flow lacks the action being dispatched.
 */
async function findWorkstream(
  store: InMemorySessionStore,
  parentSessionId: string,
  flowKind: string,
  topic: string
): Promise<Workstream | undefined> {
  const all = (await store.list({})) as Workstream[];
  return all.find(
    (s) =>
      s.parentSessionId === parentSessionId && s.flowKind === flowKind && s.topic === topic
  );
}

let seq = 0;
const nextId = () => `sess_generated_${++seq}`;

async function getOrCreateWorkstream(
  store: InMemorySessionStore,
  parentSessionId: string,
  topic: string,
  flowKind: string = WORKER_FLOW
): Promise<Workstream> {
  const existing = await findWorkstream(store, parentSessionId, flowKind, topic);
  if (existing !== undefined) return existing;
  const created = makeSession(nextId(), parentSessionId, topic, flowKind);
  await store.set(created.id, created, "any");
  return created;
}

function makeCompletedRequest(id: string, sessionId: string, startedAtMs: number): RequestRecord {
  return {
    id,
    flowKind: "epic",
    actionName: "work",
    userId: "u1",
    sessionId,
    status: "completed",
    startedAtMs,
    state: {},
    version: 0,
    createdAt: startedAtMs,
    updatedAt: startedAtMs,
    items: []
  } as RequestRecord;
}

describe("POC: workstream routing via (parentSessionId, flowKind, topic)", () => {
  it("routes two independent callers to the SAME workstream", async () => {
    const store = new InMemorySessionStore();
    await store.set("S", makeSession("S", undefined, undefined, PARENT_FLOW), "any");

    // Coordinator files work for FIX-981; later, a follow-up is filed for the
    // same issue from somewhere else entirely.
    const first = await getOrCreateWorkstream(store, "S", "FIX-981");
    const second = await getOrCreateWorkstream(store, "S", "FIX-981");

    expect(second.id).toBe(first.id);
    const all = await store.list({});
    expect(all.filter((s) => (s as Workstream).topic === "FIX-981")).toHaveLength(1);
  });

  it("keeps separate topics in separate workstreams", async () => {
    const store = new InMemorySessionStore();
    await store.set("S", makeSession("S", undefined, undefined, PARENT_FLOW), "any");

    const a = await getOrCreateWorkstream(store, "S", "FIX-981");
    const b = await getOrCreateWorkstream(store, "S", "FIX-982");
    expect(a.id).not.toBe(b.id);
  });

  it("flowKind is part of the key — one topic, two flows, two workstreams", async () => {
    const store = new InMemorySessionStore();
    await store.set("S", makeSession("S", undefined, undefined, PARENT_FLOW), "any");

    // Same parent, same topic, different target flow. Keying on topic alone
    // would return the researcher Workstream to an implementer dispatch, whose
    // flow has no such action.
    const research = await getOrCreateWorkstream(store, "S", "FIX-981", "researcher");
    const implement = await getOrCreateWorkstream(store, "S", "FIX-981", "implementer");

    expect(research.id).not.toBe(implement.id);
    expect(research.flowKind).toBe("researcher");
    expect(implement.flowKind).toBe("implementer");

    // ...and each still round-trips to itself.
    expect((await getOrCreateWorkstream(store, "S", "FIX-981", "researcher")).id).toBe(research.id);
    expect((await getOrCreateWorkstream(store, "S", "FIX-981", "implementer")).id).toBe(
      implement.id
    );
  });

  it("history stays isolated per workstream, parent untouched", async () => {
    const sessions = new InMemorySessionStore();
    const requests = new InMemoryRequestStore();
    await sessions.set("S", makeSession("S", undefined, undefined, PARENT_FLOW), "any");
    const ws981 = await getOrCreateWorkstream(sessions, "S", "FIX-981");
    const ws982 = await getOrCreateWorkstream(sessions, "S", "FIX-982");

    await requests.set("r_parent", makeCompletedRequest("r_parent", "S", 1), "any");
    await requests.set("r_981_a", makeCompletedRequest("r_981_a", ws981.id, 2), "any");
    await requests.set("r_981_b", makeCompletedRequest("r_981_b", ws981.id, 3), "any");
    await requests.set("r_982_a", makeCompletedRequest("r_982_a", ws982.id, 4), "any");

    const load = (sessionId: string) =>
      requests.list({ sessionId, status: "completed", limit: 50, orderBy: "startedAtMs" });

    expect((await load("S")).map((r) => r.id)).toEqual(["r_parent"]);
    expect((await load(ws981.id)).map((r) => r.id).sort()).toEqual(["r_981_a", "r_981_b"]);
    expect((await load(ws982.id)).map((r) => r.id)).toEqual(["r_982_a"]);
  });

  it("the tree query works — children of S", async () => {
    const store = new InMemorySessionStore();
    await store.set("S", makeSession("S", undefined, undefined, PARENT_FLOW), "any");
    await getOrCreateWorkstream(store, "S", "FIX-981");
    await getOrCreateWorkstream(store, "S", "FIX-982");

    const all = (await store.list({})) as Workstream[];
    const children = all.filter((s) => s.parentSessionId === "S");
    expect(children.map((s) => s.topic).sort()).toEqual(["FIX-981", "FIX-982"]);
  });

  it("RACE — concurrent get-or-create creates DUPLICATE workstreams", async () => {
    const store = new InMemorySessionStore();
    await store.set("S", makeSession("S", undefined, undefined, PARENT_FLOW), "any");

    // Two coordinators independently decide FIX-981 needs work.
    const [a, b] = await Promise.all([
      getOrCreateWorkstream(store, "S", "FIX-981"),
      getOrCreateWorkstream(store, "S", "FIX-981")
    ]);

    const all = (await store.list({})) as Workstream[];
    const dupes = all.filter((s) => s.topic === "FIX-981");

    // eslint-disable-next-line no-console
    console.log(
      `[poc] concurrent get-or-create -> distinct ids=${a.id !== b.id} ` +
        `workstreams-for-FIX-981=${dupes.length}`
    );
    expect(a.id).not.toBe(b.id);
    expect(dupes).toHaveLength(2);
  });

  it("RACE — a composite id does NOT save you: set() is an upsert, not an insert", async () => {
    const store = new InMemorySessionStore();

    // Both callers derive the SAME id from (parent, topic), so a primary-key
    // insert would collide. `expectedVersion: 0` is the strongest "I expect it
    // to be new" the interface can express.
    const id = "S:FIX-981";
    const first = await store.set(id, makeSession(id, "S", "FIX-981"), 0);
    const second = await store.set(
      id,
      { ...makeSession(id, "S", "FIX-981"), title: "second writer" },
      0
    );

    // eslint-disable-next-line no-console
    console.log(
      `[poc] composite-id create: first.ok=${first.ok} second.ok=${second.ok} ` +
        `(second should have conflicted, but did not)`
    );

    expect(first.ok).toBe(true);
    // The second create SUCCEEDS and clobbers the first: casWriteToMap treats a
    // missing record and a version-0 record identically (`current?.version ?? 0`),
    // and ExpectedVersion has no "must not exist" sentinel.
    expect(second.ok).toBe(true);
    expect((await store.get(id))?.title).toBe("second writer");
  });
});
