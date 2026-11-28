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
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createExecutionContext } from "../../src";
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

/**
 * A request record in `sessionId`, created at `at`, as stored before the
 * principal fields. `endedAt` is when its run wrote it last (its terminal
 * status); by default it was never written again.
 */
async function request(
  stores: StoreRegistry,
  id: string,
  sessionId: string,
  at: number,
  fields: {
    source?: string;
    userId?: string;
    orgId?: string | null;
    flowKind?: string;
    endedAt?: number;
    metadata?: Record<string, unknown>;
  } = {}
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
      ...(fields.source !== undefined ? { source: fields.source } : {}),
      ...(fields.metadata !== undefined ? { metadata: fields.metadata } : {})
    },
    at
  );
  const endedAt = fields.endedAt ?? at;
  await stores.request.set(id, { ...record, status: "completed", completedAtMs: endedAt, updatedAt: endedAt }, "absent");
}

describe("the birth request of a session from before kinds", () => {
  it("is the request written for it just before it was born, so a person's session reads as a person's", async () => {
    const stores = createInMemoryStores();
    const session = await legacySession(stores, "s");
    // The action's record is written before the run creates its session, and
    // its final status after.
    await request(stores, "r-birth", "s", BORN - 5, { source: "http", endedAt: BORN + 1_000 });
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

  it("is no request at all when a predecessor's run was still going at the birth, so the session reads as a machine's", async () => {
    // The id was deleted and taken again while a predecessor's person run was
    // still writing: it and this record's queued webhook birth both look like
    // a birth. Nothing ties either to this incarnation, so neither is trusted.
    const stores = createInMemoryStores();
    await request(stores, "r-predecessor", "s", BORN - 2 * MINUTE, { source: "http", endedAt: BORN + 5 * MINUTE });
    await request(stores, "r-birth", "s", BORN - 1_000, { source: "webhook", endedAt: BORN + 1_000 });
    const session = await legacySession(stores, "s");
    expect(await resolveSessionKind(stores, session)).toBe("machine");
    expect((await stores.session.get("s"))?.principalKind).toBe("machine");
  });

  it("is never a predecessor's request whose run had ended before the birth", async () => {
    // Its record was last written before this one existed, so its run can't
    // have created it: the webhook birth just after is the only one.
    const stores = createInMemoryStores();
    await request(stores, "r-predecessor", "s", BORN - 2 * MINUTE, { source: "http", endedAt: BORN - MINUTE });
    await request(stores, "r-birth", "s", BORN + 1_000, { source: "webhook" });
    const session = await legacySession(stores, "s");
    expect(await resolveSessionKind(stores, session)).toBe("machine");
  });

  it("counts a dispatch birth of a session with no parent, so a predecessor's person request in the window can't make it a person's", async () => {
    // A dispatch that creates a session with its own id and state leaves the
    // record without a parent, and its request is written just after the
    // birth. Dropping it would leave the predecessor's request as the only
    // possible birth and hand the machine's session a person's reach.
    const stores = createInMemoryStores();
    await request(stores, "r-predecessor", "s", BORN - 2 * MINUTE, { source: "http" });
    await request(stores, "r-birth", "s", BORN + 1_000, { source: "internal" });
    const session = await legacySession(stores, "s");
    expect(await resolveSessionKind(stores, session)).toBe("machine");
    expect((await stores.session.get("s"))?.principalKind).toBe("machine");
  });

  it("is a person's request whose run was still going at the birth, so a later internal turn moments after can't make the session a machine's", async () => {
    // The run that creates a session writes its final status after the
    // session exists. A wake or delivery that runs right after is a turn of
    // the session, not its birth.
    const stores = createInMemoryStores();
    await request(stores, "r-birth", "s", BORN - 5, { source: "http", endedAt: BORN + 1_000 });
    await request(stores, "r-later", "s", BORN + 5, { source: "internal" });
    const session = await legacySession(stores, "s");
    expect(await resolveSessionKind(stores, session)).toBe("person");
  });

  it("keeps a person's session a person's when a task notice is delivered into it inside the window", async () => {
    // The shape `packages/orchestration/src/tasks/notice/delivery.ts` writes: an
    // internal dispatch into an existing session, stamped with its sender.
    const stores = createInMemoryStores();
    await request(stores, "r-birth", "s", BORN - 5, { source: "http", endedAt: BORN + 2_000 });
    await request(stores, "r-notice", "s", BORN + 3 * MINUTE, {
      source: "internal",
      metadata: {
        dispatch: { type: "internal", action: "notice", from: { block: "tasks-delivery", sessionId: "worker" }, recipientLineageId: "lin_s" }
      }
    });
    const session = await legacySession(stores, "s", { lineageId: "lin_s" });
    expect(await resolveSessionKind(stores, session)).toBe("person");
  });

  it("is the first turn of a session created on its own route, which writes no request", async () => {
    // As before parentless dispatch births counted: with no request at or
    // before the birth, the earliest one after it inside the window is the
    // birth, whatever its source.
    const stores = createInMemoryStores();
    await request(stores, "r-first", "s", BORN + 30_000, { source: "http" });
    const session = await legacySession(stores, "s");
    expect(await resolveSessionKind(stores, session)).toBe("person");
  });

  it("is looked for as far before the session as the host lets a queued action wait", async () => {
    const stores = createInMemoryStores();
    const session = await legacySession(stores, "s");
    // Queued 20 minutes before a worker created the session, under a 30-minute grace.
    await request(stores, "r-birth", "s", BORN - 20 * MINUTE, { source: "http", endedAt: BORN + 1_000 });
    expect(await resolveSessionKind(stores, session, { queuedGraceMs: 30 * MINUTE })).toBe("person");
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

describe("a run in a session from before kinds", () => {
  it("writes its session's state with no retries left after the kind is backfilled", async () => {
    // The backfill writes the kind and advances the record's version. A run
    // that kept the copy it read before that would conflict on its first
    // session write, and with no retries the write fails.
    const stores = createInMemoryStores();
    const block = handler({ name: "noop", execute: (_input: { value: string }) => ({ ok: true }) });
    const flow = defineFlow({
      kind: "notes",
      session: { cas: { maxRetries: 0 } },
      actions: { run: { inputSchema: z.object({ value: z.string() }), block } }
    })();
    await legacySession(stores, "s");
    await request(stores, "r-birth", "s", BORN, { source: "http" });
    const ctx = await createExecutionContext({
      orgId: ORG,
      flow,
      actionName: "run",
      requestId: "r-owner-run",
      sessionId: "s",
      userId: "alice",
      stores
    });
    expect((await stores.session.get("s"))?.principalKind).toBe("person");
    const session = ctx.session as unknown as { setState(next: Record<string, unknown>): Promise<boolean> };
    await expect(session.setState({ mode: "written" })).resolves.toBe(true);
    expect((await stores.session.get("s"))?.state).toEqual({ mode: "written" });
  });
});
