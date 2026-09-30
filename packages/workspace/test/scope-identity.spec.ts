/**
 * Which instance of a scope a run is in.
 *
 * A `request` scope instance is one request, not one request id. An id is the
 * caller's to choose, and once its record is deleted the same id can name a
 * new request, from anyone. The directory a run workspace lives in is not
 * deleted with the record, so a key on the id alone would hand the new request
 * the old one's files. The request's incarnation, stamped once when its record
 * is first created, tells the two apart.
 *
 * The broader scopes do not move: their keys are pinned byte for byte, since
 * every existing session, user and org workspace and every projected
 * collection id is addressed by them today.
 */
import { describe, expect, it } from "vitest";
import {
  collectionIdFor,
  frameComponents,
  principalFromContext,
  scopeComponents,
  type ScopePrincipal,
  type ScopeName,
} from "../src/index";

const principal: ScopePrincipal = {
  requestId: "req_1",
  requestIncarnation: "inc_a",
  sessionId: "s1",
  userId: "u1",
  orgId: "o1",
  tenantId: "t1",
};

const keyOf = (scope: ScopeName, p: ScopePrincipal): string =>
  frameComponents([scope, ...scopeComponents(scope, p)]);

describe("the request scope", () => {
  it("names two requests under one id, in one tenant, apart", () => {
    const first = keyOf("request", principal);
    const second = keyOf("request", { ...principal, requestIncarnation: "inc_b" });
    expect(first).not.toBe(second);
  });

  it("names one request the same wherever it is read", () => {
    // A retry, a resume, or another block of the same request.
    expect(keyOf("request", { ...principal })).toBe(keyOf("request", principal));
  });

  it("keeps tenant and id: two tenants sharing an id and an incarnation stay apart", () => {
    expect(keyOf("request", principal)).not.toBe(
      keyOf("request", { ...principal, tenantId: "t2" }),
    );
    expect(keyOf("request", principal)).not.toBe(
      keyOf("request", { ...principal, requestId: "req_2" }),
    );
  });

  it("gives a context with no incarnation a key of its own, never one a token names", () => {
    const { requestIncarnation: _dropped, ...absent } = principal;
    expect(scopeComponents("request", absent)).toEqual(["t1", "req_1", undefined]);
    // Not even a token spelled like the absence marker reaches it.
    for (const token of ["", "-", "undefined"]) {
      expect(keyOf("request", absent)).not.toBe(
        keyOf("request", { ...principal, requestIncarnation: token }),
      );
    }
  });

  it("reads the incarnation off the block context's request handle", () => {
    const ctx = {
      session: { identity: { id: "s1", userId: "u1", orgId: "o1", tenantId: "t1" } },
      request: { identity: { id: "req_1" }, incarnation: "inc_a" },
    };
    expect(principalFromContext(ctx)).toEqual(principal);
    const { incarnation: _dropped, ...bare } = ctx.request;
    expect(principalFromContext({ ...ctx, request: bare }).requestIncarnation).toBeUndefined();
  });
});

describe("the broader scopes, unchanged", () => {
  // Literals, not re-derived here: each is what the key was before the request
  // scope learned about incarnations, and a change to any of them renames
  // workspaces and collections that exist today.
  const anonymous: ScopePrincipal = { requestId: "req_1", sessionId: "s1", tenantId: "t1" };

  it.each([
    ["session", principal, "7:session2:t12:s1"],
    ["user", principal, "4:user2:u1"],
    ["org", principal, "3:org2:o1"],
    ["user", anonymous, "4:user2:t12:s1"],
    ["org", anonymous, "3:org2:t12:s1"],
  ] as const)("keys %s exactly as before", (scope, p, expected) => {
    expect(keyOf(scope, p)).toBe(expected);
    expect(keyOf(scope, { ...p, requestIncarnation: "inc_other" })).toBe(expected);
  });

  it.each([
    ["session", "7:session2:t12:s111:artifacts/*"],
    ["user", "4:user2:u111:artifacts/*"],
    ["org", "3:org2:o111:artifacts/*"],
  ] as const)("names a %s-scoped collection exactly as before", (scope, expected) => {
    // The id the Claude Code integration's mounts and the bash projection
    // claim a collection by.
    expect(collectionIdFor({ scope, pattern: "artifacts/*" }, principal)).toBe(expected);
  });
});
