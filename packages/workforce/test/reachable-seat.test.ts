/**
 * Which of a logical seat's copies a post's caller may reach.
 *
 * A seat pinned to one user is reachable by that user only. The caller is the
 * bare user id: the user scope's `userId`, never its `id`, which is the user
 * record's storage key and carries the organization.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";
import { reachableSeat } from "../src/mailbox/wake-member-seats";

const seat = (id: string, ownerPin?: { orgId: string; userId?: string }) =>
  ({ id, ownerPin }) as unknown as FlowInstance;

const aliceSeat = seat("acme.~alice.research", { orgId: "acme", userId: "alice" });
const orgSeat = seat("acme.research", { orgId: "acme" });

describe("reachableSeat", () => {
  it("picks the caller's own seat by the user scope's userId", () => {
    const ctx = {
      org: { identity: { type: "org", id: "acme", orgId: "acme" } },
      user: { identity: { type: "user", id: "alice:~org:acme", userId: "alice" } },
      session: { identity: { type: "session", id: "s_1", userId: "alice", orgId: "acme" } },
    } as unknown as BlockContext;
    expect(reachableSeat([orgSeat, aliceSeat], ctx)).toBe(aliceSeat);
  });

  it("falls back to the session's bare userId, never the user record's storage key", () => {
    // A user identity without `userId` leaves only its `id`, the storage key
    // `alice:~org:acme`, which names no user and matches no pin.
    const ctx = {
      org: { identity: { type: "org", id: "acme", orgId: "acme" } },
      user: { identity: { type: "user", id: "alice:~org:acme" } },
      session: { identity: { type: "session", id: "s_1", userId: "alice", orgId: "acme" } },
    } as unknown as BlockContext;
    expect(reachableSeat([orgSeat, aliceSeat], ctx)).toBe(aliceSeat);
  });
});
