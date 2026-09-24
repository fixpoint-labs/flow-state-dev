/**
 * The (org, person) cell a hired seat's shared user data keys into.
 *
 * A seat is registered with a pin copied from its hire row. Its shared
 * user-scoped data must land in one cell per (org, person): the org from the
 * pin, the person from the caller. Everything else keeps the key it already
 * wrote, byte for byte, so nothing unpinned has to move.
 *
 * The literal strings below are the persisted contract. The operator's copy
 * step in the persistence docs names `<person>:~org:<org>`, so a change here is
 * a change to stored data, not a refactor.
 */
import { describe, expect, it } from "vitest";
import type { InstanceOwnerPin } from "@flow-state-dev/core/types";
import { resolveOrgStorageKey, resolveUserStorageKey } from "../src";
import {
  resolveResourceScopeId,
  resourceScopeIds,
  toIsolationFlow,
  type IsolationFlow,
} from "../src/stores/scope-keys";

const ACME_PRIVATE: InstanceOwnerPin = { orgId: "acme", userId: "alice" };
const ACME_VISIBLE: InstanceOwnerPin = { orgId: "acme" };

const seat = (ownerPin?: InstanceOwnerPin, resources?: IsolationFlow["resources"]): IsolationFlow => ({
  id: "acme.~alice.research",
  isolateUserState: false,
  isolateOrgState: false,
  ownerPin,
  resources,
});

describe("the seat cell key", () => {
  it("keys a pinned seat's shared user data at <person>:~org:<org>", () => {
    expect(resolveUserStorageKey("alice", seat(ACME_PRIVATE))).toBe("alice:~org:acme");
    expect(resolveResourceScopeId("alice", seat(ACME_PRIVATE), "user", false)).toBe(
      "alice:~org:acme"
    );
  });

  it("takes the person from the caller, not the pin, on an org-visible seat", () => {
    // Bob using Acme's org-visible seat stores in (acme, bob).
    expect(resolveUserStorageKey("bob", seat(ACME_VISIBLE))).toBe("bob:~org:acme");
    expect(resolveResourceScopeId("bob", seat(ACME_VISIBLE), "user", false)).toBe(
      "bob:~org:acme"
    );
  });

  it("gives the same person a different cell in each org", () => {
    const globex = resolveUserStorageKey("alice", seat({ orgId: "globex", userId: "alice" }));
    expect(globex).toBe("alice:~org:globex");
    expect(globex).not.toBe(resolveUserStorageKey("alice", seat(ACME_PRIVATE)));
  });

  it("reads exactly the cell a pinned seat writes", () => {
    const flow = seat(ACME_PRIVATE, {
      notes: { scope: "user" },
      scratch: { scope: "user", flowIsolation: true },
      board: { scope: "org" },
    });
    expect(resourceScopeIds("alice", flow, "user").sort()).toEqual(
      ["alice:~org:acme", "alice:acme.~alice.research"].sort()
    );
    // Org scope is the org's, whatever the pin says.
    expect(resourceScopeIds("acme", flow, "org")).toEqual(["acme"]);
  });

  it("forwards the pin through toIsolationFlow", () => {
    const coerced = toIsolationFlow({ id: "acme.x", ownerPin: ACME_VISIBLE });
    expect(resolveUserStorageKey("bob", coerced)).toBe("bob:~org:acme");
  });
});

describe("keys that do not move", () => {
  const ids = ["alice", "bob", "auth0|abc123", "u"];

  it("leaves an unpinned flow's shared and isolated keys byte-identical", () => {
    for (const person of ids) {
      expect(resolveUserStorageKey(person, { id: "app", isolateUserState: false })).toBe(person);
      expect(resolveUserStorageKey(person, { id: "app", isolateUserState: true })).toBe(
        `${person}:app`
      );
      expect(resolveResourceScopeId(person, { id: "app" }, "user", false)).toBe(person);
      expect(resolveResourceScopeId(person, { id: "app" }, "user", true)).toBe(`${person}:app`);
    }
  });

  it("leaves a pinned seat's flow-isolated keys byte-identical", () => {
    // The seat's address already carries org and person.
    const isolated = { ...seat(ACME_PRIVATE), isolateUserState: true };
    expect(resolveUserStorageKey("alice", isolated)).toBe("alice:acme.~alice.research");
    expect(resolveResourceScopeId("alice", seat(ACME_PRIVATE), "user", true)).toBe(
      "alice:acme.~alice.research"
    );
  });

  it("leaves every org key byte-identical, pinned or not", () => {
    for (const pin of [undefined, ACME_PRIVATE, ACME_VISIBLE]) {
      expect(resolveOrgStorageKey("acme", { id: "acme.x", isolateOrgState: false, ownerPin: pin })).toBe(
        "acme"
      );
      expect(resolveOrgStorageKey("acme", { id: "acme.x", isolateOrgState: true, ownerPin: pin })).toBe(
        "acme:acme.x"
      );
      expect(resolveResourceScopeId("acme", { id: "acme.x", ownerPin: pin }, "org", false)).toBe("acme");
    }
  });
});

describe("no two cells share a key (BR-11)", () => {
  it("keeps every (org, person) cell distinct from every other key", () => {
    const hostile = ["u", "u:a", "a", "~org", "u:~org:a", "a\\", "u\\:a", ":", "\\:", "acme.x"];
    const seen = new Map<string, string>();
    const claim = (key: string, owner: string) => {
      const prior = seen.get(key);
      if (prior !== undefined && prior !== owner) {
        throw new Error(`${owner} and ${prior} both derive ${JSON.stringify(key)}`);
      }
      seen.set(key, owner);
    };
    for (const person of hostile) {
      claim(resolveResourceScopeId(person, { id: "x" }, "user", false), `shared(${person})`);
      for (const other of hostile) {
        claim(resolveResourceScopeId(person, { id: other }, "user", true), `iso(${person},${other})`);
        claim(
          resolveResourceScopeId(person, { id: "x", ownerPin: { orgId: other } }, "user", false),
          `cell(${other},${person})`
        );
      }
    }
    // Every triple was distinct: shared + isolated + cell per person.
    expect(seen.size).toBe(hostile.length * (1 + 2 * hostile.length));
  });

  it("does not let an org id equal to a flow id land in the isolated cell", () => {
    expect(resolveResourceScopeId("alice", { id: "x", ownerPin: { orgId: "acme.x" } }, "user", false)).not.toBe(
      resolveResourceScopeId("alice", { id: "acme.x" }, "user", true)
    );
  });

  it("does not let a person id that spells a cell key reach that cell", () => {
    expect(resolveResourceScopeId("alice:~org:acme", { id: "app" }, "user", false)).not.toBe(
      resolveResourceScopeId("alice", { id: "x", ownerPin: ACME_PRIVATE }, "user", false)
    );
  });
});
