/**
 * Where a scope's folder lives, and that it is still where bash put it.
 *
 * The golden paths below were produced by the bash tool's own rule before it
 * moved here. A bash folder holds a person's files between turns, so a path
 * that changes is files that look lost: these must not change.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encodeSegment, scopeFolder, tenantSegment } from "../src/segments";
import type { ScopePrincipal } from "../src/scope-identity";

const ROOT = "/srv/app";
const principal: ScopePrincipal = {
  requestId: "req 1",
  requestIncarnation: "inc-9",
  sessionId: "sess/../x",
  userId: "auth0|alice",
  orgId: "Acme Corp",
  tenantId: "t:1",
};

describe("scopeFolder keeps every existing bash folder where it was", () => {
  it.each([
    ["request", ".fsdev/workspaces/run/enc-t-1-39f34643f186/enc-req-1-06a3fbb9c4e3/enc-inc-9-c22e9e74b6fa"],
    ["session", ".fsdev/workspaces/session/enc-t-1-39f34643f186/enc-sess----x-7e6ada00a16d"],
    ["user", ".fsdev/workspaces/user/enc-auth0-alice-4a761a4752f6"],
    ["org", ".fsdev/workspaces/org/enc-Acme-Corp-a73cb4563ee2"],
  ] as const)("%s", (scope, golden) => {
    expect(scopeFolder(ROOT, scope, principal)).toBe(path.join(ROOT, golden));
  });

  it("an anonymous user scope falls back to the session, with no tenant spelled as its own segment", () => {
    expect(scopeFolder(ROOT, "user", { requestId: "r", sessionId: "s1" })).toBe(
      path.join(ROOT, ".fsdev/workspaces/user/enc-none/enc-s1-e8bc163c82ee"),
    );
  });

  it("no id leaves the workspaces root", () => {
    for (const hostile of ["..", "../../etc", "/abs", "a/b", "C:\\x", "\0"]) {
      const folder = scopeFolder(ROOT, "session", { requestId: "r", sessionId: hostile, tenantId: hostile });
      expect(path.relative(path.join(ROOT, ".fsdev/workspaces/session"), folder).startsWith("..")).toBe(false);
    }
  });
});

describe("the checkout encoder stays apart from the folder encoder", () => {
  it("gives each lone surrogate and U+FFFD its own segment, where the folder digest would merge them", () => {
    const ids = ["\ud800", "\ud801", "\udfff", "\ufffd"];
    expect(new Set(ids.map(encodeSegment)).size).toBe(4);
    const folders = ids.map((id) => scopeFolder(ROOT, "user", { requestId: "r", sessionId: "s", userId: id }));
    expect(new Set(folders).size).toBe(1);
  });

  it("tags tenant presence rather than defaulting it", () => {
    expect(tenantSegment(undefined)).toBe("t0");
    expect(tenantSegment("t0")).not.toBe("t0");
  });
});
