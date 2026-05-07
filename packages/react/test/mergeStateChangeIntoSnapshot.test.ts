/**
 * Unit tests for the pure FIX-576 reducer that merges scope-level
 * `state_change` items into the cached SessionStateSnapshotResponse.
 *
 * Reducer policy: only update keys already present in `clientData[scope]`,
 * which mirrors the projected slice the server populated in the initial
 * snapshot. Non-exposed raw state cannot leak into the client view.
 */
import { describe, expect, it } from "vitest";
import type { SessionStateSnapshotResponse } from "@flow-state-dev/client";
import type { StateChangeItem, ItemProvenance } from "@flow-state-dev/core/items";
import {
  isReducibleStateChange,
  mergeStateChangeIntoSnapshot
} from "../src/internal/mergeStateChangeIntoSnapshot";

const provenance: ItemProvenance = {
  blockName: "runtime",
  blockInstanceId: "runtime",
  phase: "main"
};

let counter = 0;
function sc(
  partial: Partial<StateChangeItem> & Pick<StateChangeItem, "scope" | "operation" | "version">
): StateChangeItem {
  counter += 1;
  return {
    id: `item_${counter}`,
    type: "state_change",
    status: "completed",
    transient: true,
    requestId: "req",
    itemIndex: counter,
    provenance,
    ts: 0,
    ...partial
  };
}

function snapshot(
  clientData: SessionStateSnapshotResponse["clientData"]
): SessionStateSnapshotResponse {
  return {
    sessionId: "sess",
    flowKind: "test",
    clientData
  };
}

describe("isReducibleStateChange", () => {
  it("matches session/user/org-scope state_change items", () => {
    expect(
      isReducibleStateChange(
        sc({ scope: "session", operation: "patch", version: 1, delta: { a: 1 } })
      )
    ).toBe(true);
    expect(
      isReducibleStateChange(
        sc({ scope: "user", operation: "patch", version: 1, delta: { a: 1 } })
      )
    ).toBe(true);
    expect(
      isReducibleStateChange(
        sc({ scope: "org", operation: "patch", version: 1, delta: { a: 1 } })
      )
    ).toBe(true);
  });

  it("ignores block_instance and request scopes (no clientData slot)", () => {
    expect(
      isReducibleStateChange(
        sc({ scope: "block_instance", operation: "patch", version: 1 })
      )
    ).toBe(false);
    expect(
      isReducibleStateChange(
        sc({ scope: "request", operation: "patch", version: 1 })
      )
    ).toBe(false);
  });
});

describe("mergeStateChangeIntoSnapshot", () => {
  it("returns null when prev is null", () => {
    const next = mergeStateChangeIntoSnapshot(
      null,
      sc({ scope: "session", operation: "patch", version: 1, delta: { a: 1 } })
    );
    expect(next).toBeNull();
  });

  it("ignores block_instance scope", () => {
    const prev = snapshot({ session: { a: 0 } });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({ scope: "block_instance", operation: "patch", version: 1, delta: { a: 1 } })
    );
    expect(next).toBe(prev);
  });

  it("ignores request scope (no clientData slot)", () => {
    const prev = snapshot({ session: { a: 0 } });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({ scope: "request", operation: "patch", version: 1, delta: { phase: "x" } })
    );
    expect(next).toBe(prev);
  });

  it("returns prev unchanged when scope clientData is missing (no anchor)", () => {
    const prev = snapshot({});
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "patch",
        version: 1,
        delta: { foo: "first" }
      })
    );
    expect(next).toBe(prev);
  });

  it("merges patch delta only for keys already exposed in clientData", () => {
    const prev = snapshot({ session: { foo: "old", bar: 1 } });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "patch",
        version: 1,
        delta: { foo: "new", secret: "leaked" }
      })
    );
    expect(next).not.toBe(prev);
    expect(next?.clientData.session).toEqual({ foo: "new", bar: 1 });
    expect(next?.clientData.session?.secret).toBeUndefined();
  });

  it("skips patch deltas that carry the keyed-updater shape (no resolved value)", () => {
    const prev = snapshot({ session: { foo: 1 } });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "patch",
        version: 1,
        path: "foo",
        delta: { path: "foo" }
      })
    );
    expect(next).toBe(prev);
  });

  it("merges setStateRecord delta into the targeted record only when field is exposed", () => {
    const prev = snapshot({
      session: { flags: { active: true, other: false } }
    });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "patch",
        version: 1,
        path: "flags.seen",
        delta: { flags: { seen: true } }
      })
    );
    expect(next?.clientData.session?.flags).toEqual({
      active: true,
      other: false,
      seen: true
    });
  });

  it("ignores setStateRecord targeting a non-exposed field", () => {
    const prev = snapshot({ session: { flags: { active: true } } });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "patch",
        version: 1,
        path: "secret.seen",
        delta: { secret: { seen: true } }
      })
    );
    expect(next).toBe(prev);
  });

  it("set merges only keys already in clientData (preserves derived projections)", () => {
    // `derivedCount` simulates a derived projection that's in clientData but
    // not in the raw scope state delta — it must survive a setState reduce.
    const prev = snapshot({
      session: { foo: "old", bar: 1, derivedCount: 99 }
    });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "set",
        version: 1,
        delta: { foo: "fresh", bar: 7, secret: "leaked" }
      })
    );
    expect(next?.clientData.session).toEqual({
      foo: "fresh",
      bar: 7,
      derivedCount: 99
    });
  });

  it("adds increments on incState, only for exposed numeric keys", () => {
    const prev = snapshot({ session: { count: 5, total: 10 } });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "increment",
        version: 1,
        delta: { count: 2, total: -3, hidden: 5 }
      })
    );
    expect(next?.clientData.session).toEqual({ count: 7, total: 7 });
    expect(next?.clientData.session?.hidden).toBeUndefined();
  });

  it("appends to arrays on push when path is already exposed", () => {
    const prev = snapshot({ session: { notes: ["a", "b"] } });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "push",
        version: 1,
        path: "notes",
        delta: "c"
      })
    );
    expect(next?.clientData.session?.notes).toEqual(["a", "b", "c"]);
  });

  it("ignores push for a non-exposed field", () => {
    const prev = snapshot({ session: { other: 1 } });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "push",
        version: 1,
        path: "notes",
        delta: "first"
      })
    );
    expect(next).toBe(prev);
  });

  it("removes a sub-key on delete_key when field is exposed", () => {
    const prev = snapshot({
      session: { flags: { a: true, b: false } }
    });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "delete_key",
        version: 1,
        path: "flags.a",
        delta: { flags: "a" }
      })
    );
    expect(next?.clientData.session?.flags).toEqual({ b: false });
  });

  it("returns prev unchanged for delete_key when field is not exposed", () => {
    const prev = snapshot({ session: { other: 1 } });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "delete_key",
        version: 1,
        path: "secret.a",
        delta: { secret: "a" }
      })
    );
    expect(next).toBe(prev);
  });

  it("ignores atomic operations (no structured delta)", () => {
    const prev = snapshot({ session: { foo: 1 } });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({ scope: "session", operation: "atomic", version: 1 })
    );
    expect(next).toBe(prev);
  });

  it("returns prev reference when shallow-equal merge yields no change (re-render isolation)", () => {
    const prev = snapshot({ session: { foo: "same" } });
    const next = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "session",
        operation: "patch",
        version: 1,
        delta: { foo: "same" }
      })
    );
    expect(next).toBe(prev);
  });

  it("user and org scopes are reduced independently", () => {
    const prev = snapshot({
      session: { foo: 1 },
      user: { role: "guest" },
      org: { tier: "free" }
    });
    const afterUser = mergeStateChangeIntoSnapshot(
      prev,
      sc({
        scope: "user",
        operation: "patch",
        version: 1,
        delta: { role: "admin" }
      })
    );
    expect(afterUser?.clientData.user).toEqual({ role: "admin" });
    expect(afterUser?.clientData.session).toBe(prev.clientData.session);
    expect(afterUser?.clientData.org).toBe(prev.clientData.org);

    const afterOrg = mergeStateChangeIntoSnapshot(
      afterUser,
      sc({
        scope: "org",
        operation: "patch",
        version: 2,
        delta: { tier: "pro" }
      })
    );
    expect(afterOrg?.clientData.org).toEqual({ tier: "pro" });
    expect(afterOrg?.clientData.user).toBe(afterUser?.clientData.user);
  });
});
