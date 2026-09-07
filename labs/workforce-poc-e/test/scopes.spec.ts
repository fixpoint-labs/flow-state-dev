/**
 * Proof for Workforce POC lab E: write/read goals and lessons at each
 * expressible scope, and isolation between those scopes. If a named
 * Workforce scope needed a Knowledge store to hold a body, this fails.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { defineResource } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import workforcePocEFlow, { otherKindFlow } from "../src/flow";

type Stores = ReturnType<typeof createInMemoryStores>;

const ALICE = "alice";
const BOB = "bob";
const ACME = "acme";
const OTHER_ORG = "other-org";

type ActionName =
  | "writeUserGoals"
  | "readUserGoals"
  | "writeOrgLessons"
  | "readOrgLessons"
  | "writeTeamDoc"
  | "readTeamDoc"
  | "writeSeatMemory"
  | "readSeatMemory";

async function run(options: {
  stores: Stores;
  flow?: FlowInstance;
  action: ActionName;
  input: Record<string, unknown>;
  userId: string;
  sessionId: string;
  orgId?: string;
}) {
  const result = await runAction({
    flow: options.flow ?? workforcePocEFlow,
    actionName: options.action,
    input: options.input,
    userId: options.userId,
    sessionId: options.sessionId,
    orgId: options.orgId,
    stores: options.stores,
    runtimeConfig: {},
  });
  return {
    status: result.error === undefined ? "completed" : "failed",
    output: result.output,
    error: result.error,
  };
}

let stores: Stores;
beforeEach(() => {
  stores = createInMemoryStores();
});

describe("user-private goals — exists as scope: user", () => {
  it("writes and reads goals for that human", async () => {
    const empty = await run({
      stores,
      action: "readUserGoals",
      input: {},
      userId: ALICE,
      sessionId: "dm",
    });
    expect(empty.status).toBe("completed");
    expect(empty.output).toEqual({ body: null });

    const written = await run({
      stores,
      action: "writeUserGoals",
      input: { body: "Ship the intake form this week." },
      userId: ALICE,
      sessionId: "dm",
    });
    expect(written.status).toBe("completed");
    expect(written.output).toEqual({ written: true });

    const read = await run({
      stores,
      action: "readUserGoals",
      input: {},
      userId: ALICE,
      sessionId: "project-room",
    });
    expect(read.status).toBe("completed");
    expect(read.output).toEqual({ body: "Ship the intake form this week." });
  });

  it("does not leak to another user", async () => {
    await run({
      stores,
      action: "writeUserGoals",
      input: { body: "Alice only." },
      userId: ALICE,
      sessionId: "dm",
    });

    const bob = await run({
      stores,
      action: "readUserGoals",
      input: {},
      userId: BOB,
      sessionId: "bob-dm",
    });
    expect(bob.status).toBe("completed");
    expect(bob.output).toEqual({ body: null });
  });

  it("is shared across flow kinds for that human (default flowIsolation false)", async () => {
    await run({
      stores,
      action: "writeUserGoals",
      input: { body: "Visible to every flow Alice touches." },
      userId: ALICE,
      sessionId: "dm",
    });

    const other = await run({
      stores,
      flow: otherKindFlow,
      action: "readUserGoals",
      input: {},
      userId: ALICE,
      sessionId: "other-dm",
    });
    expect(other.status).toBe("completed");
    expect(other.output).toEqual({
      body: "Visible to every flow Alice touches.",
    });
  });
});

describe("org lessons — exists as scope: org", () => {
  it("writes and reads lessons for that org", async () => {
    const written = await run({
      stores,
      action: "writeOrgLessons",
      input: { body: "We do not invent a Knowledge type." },
      userId: ALICE,
      sessionId: "dm",
      orgId: ACME,
    });
    expect(written.status).toBe("completed");

    const alice = await run({
      stores,
      action: "readOrgLessons",
      input: {},
      userId: ALICE,
      sessionId: "dm",
      orgId: ACME,
    });
    expect(alice.output).toEqual({
      body: "We do not invent a Knowledge type.",
    });

    const bob = await run({
      stores,
      action: "readOrgLessons",
      input: {},
      userId: BOB,
      sessionId: "bob-dm",
      orgId: ACME,
    });
    expect(bob.status).toBe("completed");
    expect(bob.output).toEqual({
      body: "We do not invent a Knowledge type.",
    });
  });

  it("does not leak to another org", async () => {
    await run({
      stores,
      action: "writeOrgLessons",
      input: { body: "Acme only." },
      userId: ALICE,
      sessionId: "dm",
      orgId: ACME,
    });

    const other = await run({
      stores,
      action: "readOrgLessons",
      input: {},
      userId: ALICE,
      sessionId: "other-org-room",
      orgId: OTHER_ORG,
    });
    expect(other.status).toBe("completed");
    expect(other.output).toEqual({ body: null });
  });

  it("is not the user-private row", async () => {
    await run({
      stores,
      action: "writeUserGoals",
      input: { body: "Alice's private goal." },
      userId: ALICE,
      sessionId: "dm",
      orgId: ACME,
    });

    const org = await run({
      stores,
      action: "readOrgLessons",
      input: {},
      userId: ALICE,
      sessionId: "dm",
      orgId: ACME,
    });
    expect(org.output).toEqual({ body: null });
  });
});

describe("team / roster — no scope: team; org + roster key exists", () => {
  it("writes and reads goals at a roster key", async () => {
    const written = await run({
      stores,
      action: "writeTeamDoc",
      input: {
        rosterId: "eng",
        doc: "goals",
        body: "Eng roster: prove isolation before growing Agent.",
      },
      userId: ALICE,
      sessionId: "dm",
      orgId: ACME,
    });
    expect(written.status).toBe("completed");
    expect(written.output).toEqual({
      written: true,
      key: "rosters/eng/goals",
    });

    const read = await run({
      stores,
      action: "readTeamDoc",
      input: { rosterId: "eng", doc: "goals" },
      userId: BOB,
      sessionId: "bob-dm",
      orgId: ACME,
    });
    expect(read.status).toBe("completed");
    expect(read.output).toEqual({
      body: "Eng roster: prove isolation before growing Agent.",
    });
  });

  it("isolates one roster key from another in the same org", async () => {
    await run({
      stores,
      action: "writeTeamDoc",
      input: { rosterId: "eng", doc: "goals", body: "Eng goals." },
      userId: ALICE,
      sessionId: "dm",
      orgId: ACME,
    });

    const ops = await run({
      stores,
      action: "readTeamDoc",
      input: { rosterId: "ops", doc: "goals" },
      userId: ALICE,
      sessionId: "dm",
      orgId: ACME,
    });
    expect(ops.status).toBe("completed");
    expect(ops.output).toEqual({ body: null });
  });

  it("does not leak a roster key to another org", async () => {
    await run({
      stores,
      action: "writeTeamDoc",
      input: { rosterId: "eng", doc: "lessons", body: "Acme eng lessons." },
      userId: ALICE,
      sessionId: "dm",
      orgId: ACME,
    });

    const other = await run({
      stores,
      action: "readTeamDoc",
      input: { rosterId: "eng", doc: "lessons" },
      userId: ALICE,
      sessionId: "other",
      orgId: OTHER_ORG,
    });
    expect(other.status).toBe("completed");
    expect(other.output).toEqual({ body: null });
  });
});

describe("member / agent identity — named gap; flowIsolation is per kind", () => {
  it("survives a DM and a project room of the same flow kind", async () => {
    await run({
      stores,
      action: "writeSeatMemory",
      input: { body: "This seat remembers the last intake decision." },
      userId: ALICE,
      sessionId: "talk-to-eng-manager",
    });

    const room = await run({
      stores,
      action: "readSeatMemory",
      input: {},
      userId: ALICE,
      sessionId: "launch-room",
    });
    expect(room.status).toBe("completed");
    expect(room.output).toEqual({
      body: "This seat remembers the last intake decision.",
    });
  });

  it("is invisible to a different flow kind (the isolation that exists)", async () => {
    await run({
      stores,
      action: "writeSeatMemory",
      input: { body: "Eng-manager only." },
      userId: ALICE,
      sessionId: "dm",
    });

    const editor = await run({
      stores,
      flow: otherKindFlow,
      action: "readSeatMemory",
      input: {},
      userId: ALICE,
      sessionId: "editor-dm",
    });
    expect(editor.status).toBe("completed");
    expect(editor.output).toEqual({ body: null });
  });

  it("is shared by two sessions of the same kind — not per seat", async () => {
    await run({
      stores,
      action: "writeSeatMemory",
      input: { body: "Shared by every eng-manager seat." },
      userId: ALICE,
      sessionId: "seat-alice",
    });

    const secondSeat = await run({
      stores,
      action: "readSeatMemory",
      input: {},
      userId: ALICE,
      sessionId: "seat-alice-again",
    });
    expect(secondSeat.status).toBe("completed");
    expect(secondSeat.output).toEqual({
      body: "Shared by every eng-manager seat.",
    });
  });

  it("does not invent a member ResourceScope", () => {
    expect(() =>
      defineResource({
        scope: "member" as never,
        stateSchema: z.object({}).default({}),
      })
    ).toThrow(/session.*user.*org/);
  });
});

describe("scope: team cannot be expressed", () => {
  it("defineResource rejects scope team", () => {
    expect(() =>
      defineResource({
        scope: "team" as never,
        stateSchema: z.object({}).default({}),
      })
    ).toThrow(/session.*user.*org/);
  });
});
