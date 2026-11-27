/**
 * The workforce kit's start-up heal. Why it matters: a schedule index is
 * written only when a schedule is, so an index file lost while the app was down
 * leaves enabled routines and polls that never fire. Every user's cell is put
 * back, not one operator's, and a row the index still holds keeps its due fire.
 */
import { describe, expect, it } from "vitest";
import type { KitStartedHost } from "@flow-state-dev/core";
import type { ScheduleIndex, ScheduleIndexEntry } from "@flow-state-dev/scheduled/collection";
import { reassertRoutineIndexes } from "../src/routines/reassert-indexes";

function memoryIndex(): ScheduleIndex & { entries: Map<string, ScheduleIndexEntry> } {
  const entries = new Map<string, ScheduleIndexEntry>();
  const id = (e: { cell: string; key: string }) => `${e.cell}\n${e.key}`;
  return {
    entries,
    upsert: async (entry) => void entries.set(id(entry), entry),
    ensure: async (entry) => void (entries.has(id(entry)) || entries.set(id(entry), entry)),
    remove: async (entry) => void entries.delete(id(entry)),
    claimDue: async () => [],
  };
}

const schedule = (orgId: string, enabled = true) => ({ state: { orgId, cron: "*/5 * * * *", kind: "k", enabled } });

/** Two users in two organizations, each with a clock routine and a poll; one poll paused. */
const host: KitStartedHost = {
  userCells: async () => [
    { userId: "ana", orgId: "acme", cell: "ana:~org:acme" },
    { userId: "ben", orgId: "beta", cell: "ben:~org:beta" },
  ],
  readUserResources: async (cell, prefix) => {
    const org = cell.endsWith("acme") ? "acme" : "beta";
    if (prefix === "workforce/schedules/") return { "workforce/schedules/standup": schedule(org) };
    return { "workforce/subscription-polls/pr": schedule(org, org === "acme") };
  },
};

describe("putting the routines back at start", () => {
  it("reasserts every enabled routine and poll in every user cell, skipping a paused one", async () => {
    const clock = memoryIndex();
    const poll = memoryIndex();
    expect(await reassertRoutineIndexes(host, { index: clock, pollIndex: poll })).toEqual({ clock: 2, poll: 1 });
    expect([...clock.entries.values()].map((e) => [e.userId, e.orgId, e.key])).toEqual([["ana", "acme", "standup"], ["ben", "beta", "standup"]]);
    expect([...poll.entries.values()].map((e) => [e.userId, e.key])).toEqual([["ana", "pr"]]);
  });

  it("leaves a row the index still holds, so its due fire doesn't move", async () => {
    const clock = memoryIndex();
    clock.entries.set("ana:~org:acme\nstandup", { cell: "ana:~org:acme", userId: "ana", orgId: "acme", key: "standup", cron: "*/5 * * * *", nextFireAt: 1 });
    await reassertRoutineIndexes(host, { index: clock, pollIndex: undefined });
    expect(clock.entries.get("ana:~org:acme\nstandup")?.nextFireAt).toBe(1);
  });
});
