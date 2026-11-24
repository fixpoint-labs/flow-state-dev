/**
 * Where a task's input check finds its installation (FIX-2894): by the
 * objects that name it, never by scanning or guessing. Each flow's `work`
 * door names the installation that built it; a session is noted with the
 * source its request ran on; a session noted with none resolves none, so a
 * raw handle there refuses `input_unchecked`, however many installations the
 * process holds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
});

/** A fresh registry and harness, so nothing an earlier test built is in them. */
async function fresh() {
  vi.resetModules();
  const ledger = await import("../src/task-input/checked-ledger");
  const entry = await import("../src/worker-task-entry");
  const harness = await import("./conversation-board-harness");
  return { ledger, entry, harness };
}

describe("the installation a task's input check resolves", { timeout: 60_000 }, () => {
  it("resolves each installation's own source by its door, with two installations in one process", async () => {
    const { ledger, entry, harness } = await fresh();
    const a = harness.bootBoardHost();
    const b = harness.bootBoardHost();
    try {
      const doorOf = (host: typeof a) => entry.conversationTaskDoorOf(host.installation.workerFlows().tasker!.flow)!;
      const [sessionA, sessionB] = [{}, {}];
      expect(ledger.noteSourceOfDoor(sessionA, doorOf(a))).toBe(ledger.taskInputSourceOf(a.installation));
      expect(ledger.noteSourceOfDoor(sessionB, doorOf(b))).toBe(ledger.taskInputSourceOf(b.installation));
      expect(ledger.taskInputSourceOf(a.installation)).not.toBe(ledger.taskInputSourceOf(b.installation));
      expect(ledger.sourceOfSession(sessionA)).toBe(ledger.taskInputSourceOf(a.installation));
      expect(ledger.sourceOfSession(sessionB)).toBe(ledger.taskInputSourceOf(b.installation));
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });

  // The registry used to fall back to the lone installation for a session noted
  // with none: a guess, which a second installation turned into a refusal.
  it("resolves no source for a session noted with none, even with one installation in the process", async () => {
    const { ledger, harness } = await fresh();
    const only = harness.bootBoardHost();
    try {
      expect(ledger.taskInputSourceOf(only.installation)).toBeDefined();
      expect(ledger.sourceOfSession({})).toBeUndefined();
    } finally {
      await only.dispose();
    }
  });

  it("fails closed: a raw handle in a session noted with none refuses a write it can't check, and files nothing", async () => {
    const { ledger } = await fresh();
    const filed: unknown[] = [];
    const raw = { createTask: async (init: unknown) => filed.push(init), patchSettings: async () => ({ outcome: "recorded" }) } as never;
    const handle = ledger.checkedLedger({ session: {} } as never, raw, { has: async () => true, refusal: () => "" });
    await expect(handle.createTask({ goal: "g", assignee: "ops.triager", input: { ticket: 1 } })).rejects.toMatchObject({ code: "input_unchecked" });
    await expect(handle.patchSettings("t", { input: {} })).rejects.toMatchObject({ code: "input_unchecked" });
    expect(filed).toEqual([]);
  });

  // Codex P1: one prebuilt flow given to two installations shares its door, and
  // the lookup picked the newest. It now binds nothing, so a raw handle there refuses.
  it("binds no installation for a door two installations share, so a raw handle there refuses, never routed to either", async () => {
    const { ledger, entry, harness } = await fresh();
    const a = harness.bootBoardHost();
    const b = harness.bootBoardHost();
    try {
      const door = entry.conversationTaskDoorOf(a.installation.workerFlows().tasker!.flow)!;
      // What a second installation built with A's prebuilt flow registers: the same door, its own source.
      b.installation.workerFlows();
      ledger.registerTaskDoor(door, ledger.taskInputSourceOf(b.installation)!);
      const session = {};
      expect(ledger.noteSourceOfDoor(session, door)).toBeUndefined();
      expect(ledger.sourceOfSession(session)).toBeUndefined();
      const filed: unknown[] = [];
      const handle = ledger.checkedLedger({ session } as never, { createTask: async (init: unknown) => filed.push(init) } as never, { has: async () => true, refusal: () => "" });
      await expect(handle.createTask({ goal: "g", assignee: "eng.tasker", input: {} })).rejects.toMatchObject({ code: "input_unchecked" });
      expect(filed).toEqual([]);
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });

  // Codex P1: with a shared door, a claim whose request already resolved its
  // worker (pinned by installation, server-side) still bound nothing, so a stale
  // task's server-owned values couldn't be filled again.
  it("binds a shared door to the installation the session's request was already pinned to, and to nothing unpinned", async () => {
    const { ledger, entry, harness } = await fresh();
    const a = harness.bootBoardHost();
    const b = harness.bootBoardHost();
    try {
      const door = entry.conversationTaskDoorOf(a.installation.workerFlows().tasker!.flow)!;
      const sourceA = ledger.taskInputSourceOf(a.installation)!;
      const sourceB = ledger.taskInputSourceOf(b.installation)!;
      ledger.registerTaskDoor(door, sourceB);
      // What `resolveWorker` notes on the session: its own installation.
      const pinned = {};
      ledger.noteTaskInputSource(pinned, sourceA);
      expect(ledger.noteSourceOfDoor(pinned, door)).toBe(sourceA);
      expect(ledger.noteSourceOfDoor({}, door)).toBeUndefined();
      // Pinned to an installation that never registered the door: still nothing.
      const elsewhere = {};
      ledger.noteTaskInputSource(elsewhere, { declarationOf: () => undefined, workerOf: async () => undefined });
      expect(ledger.noteSourceOfDoor(elsewhere, door)).toBeUndefined();
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });

  // A refused hire used to register its flows' doors as they resolved, so a
  // second installation given a live one's prebuilt flow made that door shared,
  // and the live installation's raw handles failed closed.
  it("leaves a live installation's door its own when a second hire with the same prebuilt flow is refused", async () => {
    const { ledger, entry, harness } = await fresh();
    const installationModule = await import("../src/workers/installation");
    const register = await import("../src/workers/register");
    const a = harness.bootBoardHost();
    try {
      const shared = a.installation.workerFlows().tasker!.flow;
      const b = installationModule.createWorkerInstallation({
        standardWorkers: harness.boardWorkers(),
        workerFlows: { tasker: { flow: shared as never, roles: ["contributor"] } }
      });
      expect(() => register.hireWorkforce(b)).toThrow();
      const door = entry.conversationTaskDoorOf(shared)!;
      const session = {};
      expect(ledger.noteSourceOfDoor(session, door)).toBe(ledger.taskInputSourceOf(a.installation));
      expect(ledger.sourceOfSession(session)).toBe(ledger.taskInputSourceOf(a.installation));
    } finally {
      await a.dispose();
    }
  });

  it("keeps nothing it can be asked to list: every lookup is keyed, and an unknown door resolves none", async () => {
    const { ledger } = await fresh();
    // Weak maps only: a dropped installation, and its flows' doors, are not kept by the registry.
    expect(ledger.noteSourceOfDoor({}, {})).toBeUndefined();
    const exported = Object.keys(ledger).filter((name) => /source/i.test(name)).sort();
    expect(exported).toEqual(["noteSourceOfDoor", "noteTaskInputSource", "registerTaskInputSource", "sourceOfSession", "taskInputSourceOf"]);
  });
});
