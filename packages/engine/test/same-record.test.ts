/**
 * `isSameSession` and `isSameRequest`: whether a record read again by its id
 * is still the one an earlier read found.
 *
 * An id can be deleted and used again, by anyone. Each field that tells the
 * record under the id apart from the one read earlier is changed on its own
 * here, and each alone makes it another record. Fields a record changes over
 * its life do not. A record that stores "unbound" as `null` and one that
 * omits the key are the same record, as every scope comparison treats them.
 */
import { describe, expect, it } from "vitest";
import type { RequestRecord, SessionRecord } from "../src";
import { isSameRequest, isSameSession } from "../src/stores/scope-keys";

const session: SessionRecord = {
  id: "t1:s1",
  flowKind: "chat",
  flowId: "chat",
  userId: "alice",
  orgId: "org_a",
  tenantId: "t1",
  lineageId: "lin_1",
  state: {},
  version: 3,
  createdAt: 1_000,
  updatedAt: 2_000,
  journal: []
};

const request = {
  id: "req_1",
  sessionId: "s1",
  flowKind: "chat",
  flowId: "chat",
  actionName: "say",
  userId: "alice",
  orgId: "org_a",
  tenantId: "t1",
  source: "http",
  status: "in_progress",
  startedAtMs: 1_000,
  state: {},
  version: 0,
  createdAt: 1_000,
  updatedAt: 1_000
} as RequestRecord;

describe("isSameSession", () => {
  it.each([
    ["tenant", { tenantId: "t2" }],
    ["owner", { userId: "mallory" }],
    ["organization", { orgId: "org_b" }],
    ["flow kind", { flowKind: "notes" }],
    ["flow instance", { flowId: "chat.other" }],
    ["birth", { createdAt: 1_001 }],
    ["lineage", { lineageId: "lin_2" }]
  ] as const)("is another session under another %s", (_field, change) => {
    expect(isSameSession(session, { ...session, ...change })).toBe(false);
  });

  it("is the same session after it changes over its life", () => {
    expect(
      isSameSession(session, {
        ...session,
        version: 9,
        updatedAt: 9_000,
        state: { step: 2 },
        latestRequestId: "req_9",
        title: "renamed"
      })
    ).toBe(true);
  });

  it("reads an unbound tenant, organization or flow instance stored as null as one left out", () => {
    const unbound = { ...session, tenantId: undefined, orgId: undefined, flowId: undefined };
    const nulled = { ...session, tenantId: null, orgId: null, flowId: null } as unknown as SessionRecord;
    expect(isSameSession(unbound, nulled)).toBe(true);
  });
});

describe("isSameRequest", () => {
  it.each([
    ["session", { sessionId: "s2" }],
    ["tenant", { tenantId: "t2" }],
    ["owner", { userId: "mallory" }],
    ["organization", { orgId: "org_b" }],
    ["flow kind", { flowKind: "notes" }],
    ["flow instance", { flowId: "chat.other" }],
    ["birth", { createdAt: 1_001 }]
  ] as const)("is another request under another %s", (_field, change) => {
    expect(isSameRequest(request, { ...request, ...change })).toBe(false);
  });

  it("is the same request after it changes over its life", () => {
    expect(
      isSameRequest(request, {
        ...request,
        status: "completed",
        version: 4,
        updatedAt: 5_000,
        completedAtMs: 5_000,
        items: []
      })
    ).toBe(true);
  });

  it("reads an unbound tenant, organization or flow instance stored as null as one left out", () => {
    const unbound = { ...request, tenantId: undefined, orgId: undefined, flowId: undefined };
    const nulled = { ...request, tenantId: null, orgId: null, flowId: null } as unknown as RequestRecord;
    expect(isSameRequest(unbound, nulled)).toBe(true);
  });
});
