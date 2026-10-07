/**
 * V5 — a seat's door (FIX-1690, BR-1, BR-2).
 *
 * An app sends a person's line into a seat's session through the door the
 * seat's inventory row names, without knowing the seat's kind. So the hire
 * reads it off the kind once: the one public action with `userMessage` and a
 * `{ message }` input.
 *
 * A worker flow with none, or with two, is refused when it is registered
 * (FIX-1789), so every hired seat has exactly one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { hireWorkforce } from "../src/hire";
import { openInventory } from "../src/inventory/open-inventory";
import type { WorkerManifest } from "../src/manifest";
import { seatDoorOf } from "../src/seat-door";
import { workerConfigSchema } from "../src/worker-config";
import { checkHiredSeatRow } from "../src/roster/check";
import { toHiredSeatRow } from "../src/roster/rows";

const message = z.object({ message: z.string() });
const echo = handler({ name: "door-echo", inputSchema: message, outputSchema: message, execute: (i) => i });
const note = z.object({ note: z.string() });
const work = handler({ name: "door-work", inputSchema: note, outputSchema: note, execute: (i) => i });

/** A kind with no door: its one action takes `{ note }` and writes no user item. */
const quietKind = defineFlow({
  kind: "quiet",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    run: { inputSchema: note, block: work },
    // Takes `{ message }` but declares no `userMessage`: not a door.
    log: { inputSchema: message, block: echo },
  },
});

/** A kind with two doors. */
const twoDoorKind = defineFlow({
  kind: "two-door",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    message: { inputSchema: message, block: echo, userMessage: (i: { message: string }) => i.message },
    say: { inputSchema: message, block: echo, userMessage: (i: { message: string }) => i.message },
    // `userMessage` but the wrong input: not a door, so not a third.
    work: { inputSchema: note, block: work, userMessage: (i: { note: string }) => i.note },
  },
});

/** A kind with one door, under a name other than the built-in's. */
const deskKind = defineFlow({
  kind: "desk",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    run: { inputSchema: note, block: work },
    ask: { inputSchema: message, block: echo, userMessage: (i: { message: string }) => i.message },
  },
});

const kinds = { desk: deskKind };

function record(id: string, flow?: string): WorkerManifest {
  return { id, declared: { description: id, ...(flow === undefined ? {} : { flow }) }, body: "" };
}

afterEach(() => vi.restoreAllMocks());

function refusalOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("a seat's door (BR-1, BR-2)", () => {
  it("is the built-in agent kind's `run`", () => {
    const [seat] = hireWorkforce([record("eng.lead")], { workerFlows: kinds });
    expect(seat!.kind).toBe("agent");
    expect(seatDoorOf(seat!)).toEqual({ door: "run" });
  });

  it("is the one public action a kind declares for a person's message", () => {
    const [seat] = hireWorkforce([record("eng.desk", "desk")], { workerFlows: kinds });
    expect(seatDoorOf(seat!)).toEqual({ door: "ask" });
  });

  it("refuses a kind with no door when it is registered, and hires nothing", () => {
    const message = refusalOf(() => hireWorkforce([record("eng.quiet", "quiet")], { workerFlows: { quiet: quietKind } }));
    expect(message).toContain('worker flow "quiet" has no door');
    expect(message).toContain("nothing was hired");
  });

  it("refuses a kind with two doors when it is registered, naming both, and prints no warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const message = refusalOf(() =>
      hireWorkforce([record("eng.chatty", "two-door")], { workerFlows: { "two-door": twoDoorKind } }),
    );
    expect(message).toContain('worker flow "two-door" has 2 doors ("message", "say")');
    expect(warn).not.toHaveBeenCalled();
  });

  it("is written on the seat's inventory row at boot", async () => {
    const seats = hireWorkforce([record("eng.lead"), record("eng.desk", "desk")], {
      workerFlows: kinds,
    });
    const sent: unknown[] = [];
    await openInventory(
      { seats, mailboxes: [] },
      {
        run: async (request) => void sent.push(request.input),
        userId: "u",
        orgId: "org",
        seatWriter: { flowKind: "mailbox" },
      },
    );
    expect(sent).toEqual([
      {
        seats: [
          { id: "eng.desk", kind: "desk", door: "ask", hired: false, incarnation: null },
          { id: "eng.lead", kind: "agent", door: "run", hired: false, incarnation: null },
        ],
      },
    ]);
  });
});

describe("a seat's origin on its inventory row", () => {
  it("is `hired: true` for a seat whose id is its address, and `false` for a declared one, even one named like the org", async () => {
    // A team-list reader tells the two apart by this, not by the id's shape:
    // `org.lead` below is a declared team `org` in organization `org`.
    const seats = hireWorkforce(
      [{ ...record("org.support.ada"), seatId: "support.ada" }, record("org.lead")],
      { workerFlows: kinds },
    );
    const sent: Array<{ seats: Array<{ id: string; hired: boolean | null }> }> = [];
    await openInventory(
      { seats, mailboxes: [] },
      {
        run: async (request) => void sent.push(request.input as (typeof sent)[number]),
        userId: "u",
        orgId: "org",
        seatWriter: { flowKind: "mailbox" },
      },
    );
    expect(sent[0]!.seats.map((row) => [row.id, row.hired])).toEqual([
      ["org.lead", false],
      ["org.support.ada", true],
    ]);
  });

  it("keeps a hired seat's incarnation when the boot rewrites its row, so a user-owned hire stays listed after a restart", async () => {
    const row = toHiredSeatRow({ seatId: "research", flow: "agent", owningOrgId: "org", ownerUserId: "u1", incarnation: "i-9" });
    const checked = checkHiredSeatRow("org", row, kinds);
    if (!checked.ok) throw new Error(checked.detail);
    const sent: Array<{ seats: Array<{ id: string; incarnation: string | null }> }> = [];
    await openInventory(
      { seats: [checked.seat], mailboxes: [] },
      {
        run: async (request) => void sent.push(request.input as (typeof sent)[number]),
        userId: "u",
        orgId: "org",
        seatWriter: { flowKind: "mailbox" },
      },
    );
    expect(sent[0]!.seats.map((seat) => [seat.id, seat.incarnation])).toEqual([["org.~u1.research", "i-9"]]);
  });
});
