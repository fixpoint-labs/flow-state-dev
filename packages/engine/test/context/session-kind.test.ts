// FIX-2942; BP-030.
/**
 * A session from before `SessionRecord.principalKind` is classified from the
 * request that created it, and only that one.
 *
 * Why these matter: the kind decides whether a run in the session may reach
 * the owner's other sessions. Session deletion leaves request records behind,
 * and an id can be taken again; retention prunes old requests. So a backfill
 * that reads "the earliest request under this id" can read a predecessor's
 * person request for a machine's session, or, once the machine's own birth
 * request is pruned, a later person request. Either would hand a machine's
 * session a person's reach. The birth request is the one written for this
 * record: its owner, organization, tenant and flow, at the record's birth.
 * The answer is written onto the record the first time, and the store keeps
 * it from then on.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../../src/host";
import { createInitialRequestRecord } from "../../src/context/initial-request-record";
import { resolveSessionKind } from "../../src/context/session-kind";
import type { SessionRecord, StoreRegistry } from "../../src/stores/types";

const ORG = "acme";
const BORN = 1_700_000_000_000;
const MINUTE = 60_000;

/** A session record as a release before `principalKind` stored it. */
async function legacySession(stores: StoreRegistry, id: string, fields: Partial<SessionRecord> = {}): Promise<SessionRecord> {
  const record: SessionRecord = {
    id,
    state: {},
    version: 3,
    createdAt: BORN,
    updatedAt: BORN,
    flowKind: "notes",
    flowId: "notes",
    userId: "alice",
    orgId: ORG,
    journal: [],
    ...fields
  };
  await stores.session.set(id, record, "any");
  return record;
}

/** A request record in `sessionId`, created at `at`, as stored before the principal fields. */
async function request(
  stores: StoreRegistry,
  id: string,
  sessionId: string,
  at: number,
  fields: { source?: string; userId?: string; orgId?: string | null; flowKind?: string } = {}
): Promise<void> {
  const record = createInitialRequestRecord(
    {
      requestId: id,
      flowKind: fields.flowKind ?? "notes",
      flowId: fields.flowKind ?? "notes",
      actionName: "run",
      userId: fields.userId ?? "alice",
      sessionId,
      ...(fields.orgId === null ? {} : { orgId: fields.orgId ?? ORG }),
      ...(fields.source !== undefined ? { source: fields.source } : {})
    },
    at
  );
  await stores.request.set(id, { ...record, status: "completed" }, "absent");
}

describe("the birth request of a session from before kinds", () => {
  it("is the request written for it just before it was born, so a person's session reads as a person's", async () => {
    const stores = createInMemoryStores();
    const session = await legacySession(stores, "s");
    // The action's record is written before the run creates its session.
    await request(stores, "r-birth", "s", BORN - 5, { source: "http" });
    expect(await resolveSessionKind(stores, session)).toBe("person");
  });

  it("is never a request of an earlier session that held the id", async () => {
    const stores = createInMemoryStores();
    // The id was deleted and taken again: the predecessor's person request survives the delete.
    await request(stores, "r-predecessor", "s", BORN - 60 * MINUTE, { source: "http" });
    await request(stores, "r-birth", "s", BORN, { source: "webhook" });
    const session = await legacySession(stores, "s");
    expect(await resolveSessionKind(stores, session)).toBe("machine");
  });

  it("is never another owner's, another organization's or another flow's request under the id", async () => {
    for (const other of [{ userId: "bob" }, { orgId: "globex" }, { flowKind: "elsewhere" }]) {
      const stores = createInMemoryStores();
      await request(stores, "r-other", "s", BORN - 1, { source: "http", ...other });
      await request(stores, "r-birth", "s", BORN, { source: "scheduled" });
      const session = await legacySession(stores, "s");
      expect(await resolveSessionKind(stores, session), JSON.stringify(other)).toBe("machine");
    }
  });

  it("reads a request written before organizations as its session's organization's", async () => {
    const stores = createInMemoryStores();
    await request(stores, "r-birth", "s", BORN, { source: "http", orgId: null });
    expect(await resolveSessionKind(stores, await legacySession(stores, "s"))).toBe("person");
  });
});

describe("a backfilled kind under retention", () => {
  it("is written onto the record the first time, so pruning the birth request can't flip it", async () => {
    const stores = createInMemoryStores();
    await legacySession(stores, "s");
    await request(stores, "r-birth", "s", BORN, { source: "scheduled" });
    await request(stores, "r-later", "s", BORN + 60 * MINUTE, { source: "http" });

    expect(await resolveSessionKind(stores, (await stores.session.get("s"))!)).toBe("machine");
    expect((await stores.session.get("s"))?.principalKind).toBe("machine");

    // Retention prunes the machine's birth request; a later person request remains.
    await stores.request.delete("r-birth");
    expect(await resolveSessionKind(stores, (await stores.session.get("s"))!)).toBe("machine");
  });

  it("keeps the written kind against a stale whole-record write that omits it", async () => {
    const stores = createInMemoryStores();
    const stale = await legacySession(stores, "s");
    await request(stores, "r-birth", "s", BORN, { source: "http" });
    expect(await resolveSessionKind(stores, stale)).toBe("person");
    const written = (await stores.session.get("s"))!;
    await stores.session.set("s", { ...stale, version: written.version + 1 }, "any");
    expect((await stores.session.get("s"))?.principalKind).toBe("person");
  });

  it("reads a session whose birth request is already gone as a machine's, not as its oldest remaining request's", async () => {
    const stores = createInMemoryStores();
    const session = await legacySession(stores, "s");
    await request(stores, "r-later", "s", BORN + 60 * MINUTE, { source: "http" });
    expect(await resolveSessionKind(stores, session)).toBe("machine");
  });
});
