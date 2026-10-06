/**
 * V5 — a seat's door (FIX-1690, BR-1, BR-2).
 *
 * An app sends a person's line into a seat's session through the door the
 * seat's inventory row names, without knowing the seat's kind. So the hire
 * reads it off the kind once: the one public action with `userMessage` and a
 * `{ message }` input. None is `null`; two is a reported problem and also
 * `null`, never a guess.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { __resetDeprecationWarningsForTests, defineFlow, handler } from "@flow-state-dev/core";
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

const kinds = { quiet: quietKind, "two-door": twoDoorKind };

function record(id: string, flow?: string): WorkerManifest {
  return { id, declared: { description: id, ...(flow === undefined ? {} : { flow }) }, body: "" };
}

afterEach(() => vi.restoreAllMocks());

// The two-doors warning prints once per process, so each test starts as a
// fresh process would.
beforeEach(() => {
  __resetDeprecationWarningsForTests();
});

describe("a seat's door (BR-1, BR-2)", () => {
  it("is the built-in agent kind's `run`", () => {
    const [seat] = hireWorkforce([record("eng.lead")], { kinds });
    expect(seat!.kind).toBe("agent");
    expect(seatDoorOf(seat!)).toEqual({ door: "run" });
  });

  it("is null for a kind with no action that takes a person's message", () => {
    const [seat] = hireWorkforce([record("eng.quiet", "quiet")], { kinds });
    expect(seatDoorOf(seat!)).toEqual({ door: null });
  });

  it("is a problem naming both for a kind with two, and the seat is still hired with none", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seats = hireWorkforce([record("eng.chatty", "two-door")], { kinds });
    expect(seats.map((s) => s.id)).toEqual(["eng.chatty"]);
    const found = seatDoorOf(seats[0]!);
    expect(found.door).toBeNull();
    expect(found.problem).toContain('("message", "say")');
    expect(found.problem).toContain("eng.chatty");
    // The hire reported it.
    expect(warn.mock.calls.map((c) => String(c[0])).some((line) => line.includes('"message", "say"'))).toBe(true);
  });

  it("is reported once per process, not once per hire, and a different seat's problem is still said", () => {
    // `next dev` re-runs an app's module-scope hire on every hot reload. The
    // same two-door seat is still two-door after an edit, and the sentence
    // repeated on every save hides a fresh problem among the repeats. So a
    // repeat is silent, but another seat with two doors must still be named.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doorLines = () =>
      warn.mock.calls.map((c) => String(c[0])).filter((line) => line.includes('"message", "say"'));

    hireWorkforce([record("eng.chatty", "two-door")], { kinds });
    hireWorkforce([record("eng.chatty", "two-door")], { kinds });
    hireWorkforce([record("eng.chatty", "two-door")], { kinds });
    expect(doorLines()).toHaveLength(1);
    expect(doorLines()[0]).toContain("eng.chatty");

    hireWorkforce([record("eng.chatty", "two-door"), record("eng.loud", "two-door")], { kinds });
    expect(doorLines()).toHaveLength(2);
    expect(doorLines()[1]).toContain("eng.loud");
  });

  it("is written on the seat's inventory row at boot", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seats = hireWorkforce([record("eng.lead"), record("eng.quiet", "quiet"), record("eng.chatty", "two-door")], {
      kinds,
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
          { id: "eng.chatty", kind: "two-door", door: null, hired: false, incarnation: null },
          { id: "eng.lead", kind: "agent", door: "run", hired: false, incarnation: null },
          { id: "eng.quiet", kind: "quiet", door: null, hired: false, incarnation: null },
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
      { kinds },
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
