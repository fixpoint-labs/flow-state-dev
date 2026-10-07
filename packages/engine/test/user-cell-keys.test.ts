/**
 * The per-(user, org) cell every flow keys a user's data into.
 *
 * A user's shared data lives in one cell per (user, org), `<user>:~org:<org>`,
 * and flow-isolated data adds the flow, `<user>:~org:<org>:<flow>`. The org is
 * an argument with no default: a helper called without one throws rather than
 * build a key that would read the same cell in every org.
 *
 * The literal strings below are the persisted contract, so a change here is a
 * change to stored data, not a refactor. The shared form is byte-identical to
 * the cell hired workers already wrote; org and session keys do not move.
 */
import { describe, expect, it } from "vitest";
import type { InstanceOwnerPin } from "@flow-state-dev/core/types";
import { OrgRequiredError, resolveOrgStorageKey, resolveUserStorageKey } from "../src";
import {
  resolveResourceScopeId,
  resolveSessionStorageKey,
  resourceScopeIds,
  type IsolationFlow,
} from "../src/stores/scope-keys";

const app = (resources?: IsolationFlow["resources"]): IsolationFlow => ({
  id: "app",
  isolateUserState: false,
  isolateOrgState: false,
  resources,
});

const alice = { userId: "alice", orgId: "acme" };

describe("the user key carries the org", () => {
  it("keys shared user data at <user>:~org:<org>, for a flow with no pin", () => {
    expect(resolveUserStorageKey("alice", "acme", app())).toBe("alice:~org:acme");
    expect(resolveResourceScopeId(alice, app(), "user", false)).toBe("alice:~org:acme");
  });

  it("keys flow-isolated user data at <user>:~org:<org>:<flow>", () => {
    expect(resolveUserStorageKey("alice", "acme", { id: "app", isolateUserState: true })).toBe(
      "alice:~org:acme:app"
    );
    expect(resolveResourceScopeId(alice, app(), "user", true)).toBe("alice:~org:acme:app");
  });

  it("gives one user a different cell in each org", () => {
    expect(resolveUserStorageKey("alice", "globex", app())).toBe("alice:~org:globex");
    expect(resolveUserStorageKey("alice", "globex", app())).not.toBe(
      resolveUserStorageKey("alice", "acme", app())
    );
  });

  it("reads exactly the buckets a flow writes", () => {
    const flow = app({
      notes: { scope: "user" },
      scratch: { scope: "user", flowIsolation: true },
      board: { scope: "org" },
    });
    expect(resourceScopeIds(alice, flow, "user").sort()).toEqual(
      ["alice:~org:acme", "alice:~org:acme:app"].sort()
    );
    expect(resourceScopeIds(alice, flow, "org")).toEqual(["acme"]);
  });

  it("keeps a pinned worker's shared cell byte-identical, and lets the pin choose nothing", () => {
    // The string hired workers wrote before every flow keyed per org.
    const pinned = { id: "acme.~alice.research", isolateUserState: false, ownerPin: { orgId: "acme" } };
    expect(resolveUserStorageKey("alice", "acme", pinned)).toBe("alice:~org:acme");
    // The org is the argument, never the pin's.
    const globexPin: InstanceOwnerPin = { orgId: "globex" };
    expect(resolveUserStorageKey("alice", "acme", { ...pinned, ownerPin: globexPin })).toBe(
      "alice:~org:acme"
    );
  });
});

describe("keys that do not move", () => {
  it("leaves every org key byte-identical", () => {
    for (const ownerPin of [undefined, { orgId: "acme" }, { orgId: "acme", userId: "alice" }]) {
      const flow = { id: "acme.x", isolateOrgState: false, ownerPin };
      expect(resolveOrgStorageKey("acme", flow)).toBe("acme");
      expect(resolveOrgStorageKey("acme", { ...flow, isolateOrgState: true })).toBe("acme:acme.x");
      expect(resolveResourceScopeId(alice, { id: "acme.x" }, "org", false)).toBe("acme");
      expect(resolveResourceScopeId(alice, { id: "acme.x" }, "org", true)).toBe("acme:acme.x");
    }
  });

  it("leaves every session key byte-identical", () => {
    expect(resolveSessionStorageKey("s1", undefined)).toBe("s1");
    expect(resolveSessionStorageKey("s1", "")).toBe("s1");
    expect(resolveSessionStorageKey("s1", "t1")).toBe("t1:s1");
  });
});

describe("a missing org throws (BR-9)", () => {
  const bad: unknown[] = [undefined, null, "", "   ", "\uD800", "a\uDC00"];

  it.each(bad)("refuses org %j from every user-key helper", (orgId) => {
    const org = orgId as string;
    expect(() => resolveUserStorageKey("alice", org, app())).toThrow(OrgRequiredError);
    expect(() =>
      resolveUserStorageKey("alice", org, { id: "app", isolateUserState: true })
    ).toThrow(OrgRequiredError);
    expect(() => resolveResourceScopeId({ userId: "alice", orgId: org }, app(), "user", false)).toThrow(
      OrgRequiredError
    );
    expect(() => resolveResourceScopeId({ userId: "alice", orgId: org }, app(), "user", true)).toThrow(
      OrgRequiredError
    );
    expect(() => resourceScopeIds({ userId: "alice", orgId: org }, app(), "user")).toThrow(
      OrgRequiredError
    );
  });
});

describe("no two cells share a key, and no new key is an old one (BR-7)", () => {
  // The forms an older release wrote: the one-part cross-org key and the
  // two-part flow-isolated key, each part escaped as the engine escapes it.
  const enc = (value: string) => value.replace(/[\\:]/g, "\\$&");
  const legacyShared = (user: string) => enc(user);
  const legacyIsolated = (user: string, flow: string) => `${enc(user)}:${enc(flow)}`;

  // Carried over from the spec's key-shape POC: ids built from the delimiter,
  // the escape and the marker's characters.
  const hostile = ["u", "a", ":", "\\", "~org", "~org:a", "a:~org", "u:a", "a\\", "u\\:a", "\\:", "acme.x"];

  it("keeps every (user, org) and (user, org, flow) cell distinct from each other and the old forms", () => {
    const owner = new Map<string, string>();
    const claim = (key: string, who: string) => {
      const prior = owner.get(key);
      if (prior !== undefined && prior !== who) {
        throw new Error(`${who} and ${prior} both derive ${JSON.stringify(key)}`);
      }
      owner.set(key, who);
    };
    for (const u of hostile) {
      claim(legacyShared(u), `legacy(${u})`);
      for (const f of hostile) claim(legacyIsolated(u, f), `legacy(${u},${f})`);
    }
    const legacyCount = owner.size;
    for (const u of hostile) {
      for (const o of hostile) {
        claim(resolveResourceScopeId({ userId: u, orgId: o }, app(), "user", false), `shared(${u},${o})`);
        for (const f of hostile) {
          claim(
            resolveResourceScopeId({ userId: u, orgId: o }, { id: f }, "user", true),
            `isolated(${u},${o},${f})`
          );
        }
      }
    }
    const n = hostile.length;
    expect(legacyCount).toBe(n + n * n);
    expect(owner.size - legacyCount).toBe(n * n + n * n * n);
  });

  it("does not let a user id that spells a cell key reach that cell", () => {
    expect(resolveUserStorageKey("alice:~org:acme", "globex", app())).not.toBe(
      resolveUserStorageKey("alice", "acme", app())
    );
  });
});
