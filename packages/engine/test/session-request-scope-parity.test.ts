/**
 * `requestInSessionScope` and the stores agree on which requests a session
 * holds.
 *
 * The stop hook fences on `requestInSessionScope`, a predicate over one
 * record. A session's own reads fence on the same `sessionRequestScope`
 * filter, evaluated by each store. Two evaluations of one filter can drift: a
 * key the stores honour and the predicate skips is a hole in the stop hook's
 * fence. So every key gets a record that differs on it alone, and the
 * predicate must answer what each store's listing answers.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { afterAll, describe, expect, it } from "vitest";
import { createFilesystemStores, createInMemoryStores } from "../src";
import {
  requestInSessionScope,
  sessionRequestScope,
} from "../src/context/session-request-scope";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";

const SESSION = "sess_parity";
const TENANT = "tenant_a";

/** The session the scope is built from: a bound instance, and a legacy one. */
const SESSIONS = {
  bound: { userId: "alice", orgId: DEFAULT_ORG_ID, flowKind: "chat", flowId: "chat-1" },
  legacy: { userId: "alice", orgId: DEFAULT_ORG_ID, flowKind: "chat" },
} as const;

/** One record per key, each differing from a matching one on that key alone. */
const VARIANTS: Record<string, Partial<RequestRecord> & { tenantId?: string }> = {
  matching: {},
  "other session": { sessionId: "sess_other" },
  "other tenant": { tenantId: "tenant_b" },
  "no tenant": { tenantId: undefined },
  "other owner": { userId: "bob" },
  "other org": { orgId: "org_other" },
  "other flow kind": { flowKind: "support" },
  "other flow instance": { flowId: "chat-2" },
  "no flow instance": { flowId: undefined },
};

function record(id: string, patch: Partial<RequestRecord>): RequestRecord {
  const base = {
    id,
    flowKind: "chat",
    flowId: "chat-1",
    actionName: "run",
    userId: "alice",
    orgId: DEFAULT_ORG_ID,
    sessionId: SESSION,
    tenantId: TENANT,
    status: "completed",
    startedAtMs: 1,
    completedAtMs: 2,
    version: 1,
    createdAt: 1,
    updatedAt: 2,
    state: {},
    items: [],
  } as unknown as Record<string, unknown>;
  const merged = { ...base, ...patch } as Record<string, unknown>;
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged as unknown as RequestRecord;
}

const scratch = mkdtempSync(path.join(tmpdir(), "session-scope-parity-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const STORES: Array<[string, () => StoreRegistry]> = [
  ["in-memory", () => createInMemoryStores()],
  [
    "filesystem",
    () => createFilesystemStores({ rootDir: mkdtempSync(path.join(scratch, "fs-")), developmentOnly: true }),
  ],
];

describe.each(STORES)("the stop hook's fence matches the session's reads (%s)", (_name, makeStores) => {
  for (const [sessionName, session] of Object.entries(SESSIONS)) {
    it(`agrees on every key, for a ${sessionName} session`, async () => {
      const stores = makeStores();
      const records = Object.entries(VARIANTS).map(([name, patch], i) => [name, record(`req_${i}`, patch)] as const);
      for (const [, rec] of records) await stores.request.set(rec.id, rec, "any");

      const scope = sessionRequestScope(SESSION, session, TENANT);
      const listed = new Set((await stores.request.list({ ...scope })).map((r) => r.id));

      const disagreements = records
        .filter(([, rec]) => requestInSessionScope(rec, scope) !== listed.has(rec.id))
        .map(([name, rec]) => `${name}: predicate ${requestInSessionScope(rec, scope)}, store ${listed.has(rec.id)}`);
      expect(disagreements).toEqual([]);
      // Or the agreement is vacuous: the matching record is in, the session's own reads find it.
      expect(listed.has("req_0")).toBe(true);
      expect(listed.size).toBeLessThan(records.length);
    });
  }
});
