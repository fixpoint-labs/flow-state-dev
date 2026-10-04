/**
 * Registration and binding — the two phases, and the closed door in front of
 * them.
 *
 * `mailboxInstances` is build time and synchronous; `openMailboxes` needs a
 * running host. They are separate because those are two different moments, not
 * because the work divides neatly.
 *
 * The refusals matter more than the happy path here. The session route parses
 * caller state against the flow's `stateSchema` but falls back to the caller's
 * RAW state when the parse fails — validation happens at action-execution time,
 * not session-create time — so the schema refuses nothing at open. Every
 * refusal a `configSchema` used to give for free is the binder's job now.
 */
import { describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  MAILBOX_KIND,
  mailboxInstances,
  defineMailboxFlow,
  openMailboxes,
  type MailboxManifest
} from "../src/index";
import { kindOf } from "../src/mailbox/mailbox-binder";

/** The principal every mailbox in these tests is opened for. */
const OWNER = "u_42";

/** What the fake session store holds: a session's identity as well as its state. */
type Occupant = {
  flowKind: string;
  flowId?: string;
  userId: string;
  /** What the session was opened under; absent is a session bound to no org. */
  orgId?: string;
  state: Record<string, unknown>;
};

function record(
  id: string,
  declared: Record<string, unknown> = {},
  body = "Say what you finished."
): MailboxManifest {
  return { id, declared, body };
}

/** A custom kind under the same contract the built-in carries. */
function customKind(kind: string) {
  return defineFlow({
    kind,
    cardinality: "singleton",
    session: {
      stateSchema: z.object({
        members: z.array(z.string()),
        instructions: z.string(),
        transcript: z.array(z.unknown()).default([])
      })
    },
    actions: {
      post: {
        block: handler({
          name: `${kind}-post`,
          inputSchema: z.object({ body: z.string() }),
          outputSchema: z.object({}),
          execute: () => ({})
        })
      }
    }
  });
}

describe("mailboxInstances", () => {
  it("seeds the built-in, so a roster that names no kind yields exactly one instance", () => {
    const instances = mailboxInstances([
      record("engineering.standup", { members: ["engineering.lead"] }),
      record("engineering.triage", { members: ["engineering.lead"] })
    ]);

    expect(instances).toHaveLength(1);
    expect(instances[0]?.id).toBe(MAILBOX_KIND);
    expect(instances[0]?.kind).toBe(MAILBOX_KIND);
    expect(instances[0]?.cardinality).toBe("singleton");
  });

  it("gives two records naming one custom kind a single shared instance", () => {
    const instances = mailboxInstances(
      [
        record("eng.a", { flow: "my-mailbox" }),
        record("eng.b", { flow: "my-mailbox" })
      ],
      { kinds: { "my-mailbox": customKind("my-mailbox") } }
    );

    expect(instances.map((i) => i.id)).toEqual(["my-mailbox"]);
  });

  it("yields one instance per distinct kind, the built-in included", () => {
    const instances = mailboxInstances(
      [record("eng.a"), record("eng.b", { flow: "my-mailbox" })],
      { kinds: { "my-mailbox": customKind("my-mailbox") } }
    );

    expect(instances.map((i) => i.id).sort()).toEqual(["mailbox", "my-mailbox"]);
  });

  it("lets a caller replace the built-in wholesale under its own key", () => {
    const replacement = defineMailboxFlow({
      notify: handler({
        name: "notify",
        inputSchema: z.unknown(),
        outputSchema: z.object({}),
        execute: () => ({})
      })
    });
    const instances = mailboxInstances([record("eng.a")], { kinds: { mailbox: replacement } });

    expect(instances).toHaveLength(1);
    expect(instances[0]?.internal?.actions.onPosted).toBeDefined();
  });

  it("refuses a named-but-unregistered kind by name, never falling back to the built-in", () => {
    expect(() => mailboxInstances([record("eng.a", { flow: "nope" })])).toThrow(/"nope"/);
    expect(() => mailboxInstances([record("eng.a", { flow: "nope" })])).toThrow(
      /not passed to mailboxInstances/
    );
  });

  it("refuses a factory filed under a key that is not its own kind", () => {
    expect(() =>
      mailboxInstances([record("eng.a", { flow: "mine" })], {
        kinds: { mine: customKind("actually-other") }
      })
    ).toThrow(/run a different mailbox's graph/);
  });

  it("refuses a duplicate id: a mailbox's id is its session id", () => {
    expect(() => mailboxInstances([record("eng.a"), record("eng.a")])).toThrow(/declared twice/);
  });

  it("names every bad record in one run rather than the first", () => {
    let message = "";
    try {
      mailboxInstances([
        record("eng.b", { flow: "nope" }),
        record("eng.a", { system: true }),
        record("eng.c", { colour: "blue" })
      ]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("eng.a");
    expect(message).toContain("eng.b");
    expect(message).toContain("eng.c");
    expect(message).toContain("refused 3 of 3");
  });
});

describe("what a mailbox record may declare (the closed key list)", () => {
  it("refuses a frontmatter `id:` — a mailbox's id is its identity, not a setting", () => {
    expect(() => mailboxInstances([record("eng.a", { id: "somewhere.else" })])).toThrow(/`id:`/);
  });

  it("consumes and strips `flow:` rather than refusing it", () => {
    expect(() => mailboxInstances([record("eng.a", { flow: MAILBOX_KIND })])).not.toThrow();
  });

  it("refuses `instructions:` alongside a body — two sources, no precedence rule", () => {
    expect(() =>
      mailboxInstances([record("eng.a", { instructions: "from frontmatter" }, "from the body")])
    ).toThrow(/two sources/);
  });

  it("refuses `system:`", () => {
    expect(() => mailboxInstances([record("eng.a", { system: true })])).toThrow(/`system:`/);
  });

  it("refuses a key the kind never declared", () => {
    expect(() => mailboxInstances([record("eng.a", { colour: "blue" })])).toThrow(/`colour`/);
  });

  it("refuses a `members:` that is not a list of names", () => {
    expect(() => mailboxInstances([record("eng.a", { members: "engineering.lead" })])).toThrow(
      /members/
    );
  });
});

describe("openMailboxes", () => {
  /**
   * The session substrate as `openMailboxes` meets it: create refuses a taken id
   * with a 409, and a read carries the occupant's identity as well as its
   * state, because a session id is unique per principal and not per flow.
   * `mintEmpty` is what the action path's create-or-get leaves behind — a
   * session that exists carrying no mailbox data at all.
   *
   * @param config  `retakeOnDelete`: how many times something takes the id back
   *                the moment the binder releases it, which is the race a
   *                second 409 reports.
   */
  function sessionClient(config: { retakeOnDelete?: number } = {}) {
    const created: Array<Record<string, unknown>> = [];
    const deleted: string[] = [];
    const sessions = new Map<string, Occupant>();
    let retakes = config.retakeOnDelete ?? 0;

    const createSession = vi.fn(async (options: Record<string, unknown>) => {
      const id = String(options.sessionId);
      if (sessions.has(id)) {
        throw Object.assign(new Error(`Request failed (409)`), { status: 409 });
      }
      sessions.set(id, {
        flowKind: String(options.flowKind),
        flowId: String(options.flowKind),
        userId: String(options.userId),
        ...(options.orgId === undefined ? {} : { orgId: String(options.orgId) }),
        state: (options.state ?? {}) as Record<string, unknown>
      });
      created.push(options);
      return { id };
    });

    const getSession = vi.fn(async (sessionId: string) => {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        throw Object.assign(new Error(`Request failed (404)`), { status: 404 });
      }
      return { id: sessionId, ...session };
    });

    /** What a post or read on an id nobody opened leaves behind. */
    const mintEmpty = (id: string, occupant: Partial<Occupant> = {}): void => {
      sessions.set(id, {
        flowKind: MAILBOX_KIND,
        flowId: MAILBOX_KIND,
        userId: OWNER,
        state: {},
        ...occupant
      });
    };

    const deleteSession = vi.fn(async (sessionId: string) => {
      deleted.push(sessionId);
      sessions.delete(sessionId);
      // The race a second 409 reports: something takes the id back between the
      // release and the create. An EMPTY session, because the retaker that
      // matters is the action path — the one that leaves the mailbox unbound.
      if (retakes > 0) {
        retakes -= 1;
        mintEmpty(sessionId);
      }
    });

    const stateOf = (id: string): Record<string, unknown> | undefined => sessions.get(id)?.state;

    return {
      client: { createSession, getSession, deleteSession },
      created,
      deleted,
      sessions,
      stateOf,
      mintEmpty
    };
  }

  it("opens one named session per record, carrying that mailbox's members and charter", async () => {
    const { client, created } = sessionClient();

    await openMailboxes(
      [
        record(
          "engineering.standup",
          { members: ["engineering.lead", "engineering.analyst"], description: "Daily status." },
          "Post what you finished."
        )
      ],
      { client, userId: OWNER }
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      flowKind: MAILBOX_KIND,
      sessionId: "engineering.standup",
      userId: OWNER,
      description: "Daily status.",
      state: {
        members: ["engineering.lead", "engineering.analyst"],
        instructions: "Post what you finished.",
        transcript: []
      }
    });
  });

  it("sends no org key at all — the organization is the server's to decide", async () => {
    // The binder used to take an `orgId` and hand it to `createSession`, which
    // is browser-side organization selection wearing a server-side coat: the
    // value came from whoever called `openMailboxes`. FIX-1442 removes it. What
    // the mailbox is opened under is now decided where every other identity
    // is — at principal resolution — and `mailbox-org-identity.test.ts` drives
    // the real route to show the session still comes out bound to one.
    const { client, created } = sessionClient();

    await openMailboxes([record("engineering.standup")], { client, userId: OWNER });

    expect(created[0]).not.toHaveProperty("orgId");
  });

  it("opens a custom kind's mailbox on that kind's own instance", async () => {
    const { client, created } = sessionClient();
    await openMailboxes([record("eng.a", { flow: "my-mailbox" })], { client, userId: OWNER });
    expect(created[0]).toMatchObject({ flowKind: "my-mailbox", sessionId: "eng.a" });
  });

  it("leaves a genuinely bound mailbox alone, so re-running over an unchanged roster changes nothing", async () => {
    const { client, created, deleted } = sessionClient();
    const roster = [record("engineering.standup", { members: ["a"] })];

    await openMailboxes(roster, { client, userId: OWNER });
    await expect(openMailboxes(roster, { client, userId: OWNER })).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(1);
    // The second run reads the session, finds a bound mailbox, and stops. An
    // open mailbox is never torn down, which is what keeps re-opening from
    // becoming a migration.
    expect(deleted).toEqual([]);
  });

  it("adopts a session the action path minted first, so one premature post cannot poison a mailbox", async () => {
    const { client, stateOf, mintEmpty } = sessionClient();
    const roster = [
      record("engineering.standup", { members: ["engineering.lead"] }, "Post what you finished.")
    ];

    // The order that breaks it, and the only order that does: something posts
    // or reads the id BEFORE the roster is opened. The action path is
    // create-or-get, so that mints an empty session — and the id is now taken.
    mintEmpty("engineering.standup");

    await openMailboxes(roster, { client, userId: OWNER });

    // Bound, not skipped. Without adoption the 409 is swallowed, `members` and
    // `instructions` are never written, and every later post is refused
    // `mailbox-not-bound` with no way back through the public API.
    expect(stateOf("engineering.standup")).toEqual({
      members: ["engineering.lead"],
      instructions: "Post what you finished.",
      transcript: []
    });
  });

  it("stays idempotent from a poisoned start: adopting once, then leaving the mailbox alone", async () => {
    const { client, deleted, stateOf, mintEmpty } = sessionClient();
    const roster = [record("engineering.standup", { members: ["engineering.lead"] })];

    mintEmpty("engineering.standup");
    await openMailboxes(roster, { client, userId: OWNER });
    await openMailboxes(roster, { client, userId: OWNER });

    // One adoption, and the second run recognises the mailbox it just bound.
    expect(deleted).toEqual(["engineering.standup"]);
    expect(stateOf("engineering.standup")).toMatchObject({
      members: ["engineering.lead"]
    });
  });

  /**
   * The failure mode that makes this a refusal rather than a repair: a session
   * id is unique per PRINCIPAL, not per flow. A mailbox whose id collides with
   * an ordinary session of another flow under the same user fails the boundness
   * test for the obvious reason — it is not a mailbox — and answering that with
   * a delete takes that session's content and resource state with it, at
   * startup, silently.
   */
  it("refuses an id held by another flow's session instead of deleting it", async () => {
    const { client, deleted, stateOf, mintEmpty } = sessionClient();
    mintEmpty("engineering.standup", {
      flowKind: "support-inbox",
      flowId: "support-inbox",
      state: { thread: ["a customer's message"] }
    });

    await expect(
      openMailboxes([record("engineering.standup")], { client, userId: OWNER })
    ).rejects.toThrow(/"support-inbox" session, not a "mailbox" one/);

    // The whole point: the other flow's session is still there.
    expect(deleted).toEqual([]);
    expect(stateOf("engineering.standup")).toEqual({ thread: ["a customer's message"] });
  });

  /**
   * The upgrade case, and the reason the org is not just left behind quietly.
   *
   * An app that hits the org gap already has its mailboxes open, bound to no
   * org. Passing an `orgId` afterwards cannot move them — a session's org is
   * fixed at creation — so reporting success here would send the app away
   * believing it had fixed the thing it just upgraded to fix, to find out at
   * its first post when the delivery is refused for crossing an org boundary.
   */


  it("stays a no-op when the open mailbox is already in the org asked for", async () => {
    const { client, created, deleted } = sessionClient();
    const roster = [record("engineering.standup", { members: ["a"] })];

    await openMailboxes(roster, { client, userId: OWNER, orgId: "org_acme" });
    await openMailboxes(roster, { client, userId: OWNER, orgId: "org_acme" });

    expect(created).toHaveLength(1);
    expect(deleted).toEqual([]);
  });

  // A run that names no org states no opinion about one, so it is not the
  // mismatch above: this is the ordinary idempotent re-run, from a caller that
  // simply does not pass the option.
  it("leaves an org-bound mailbox alone for a run that asks for no org", async () => {
    const { client, created, deleted } = sessionClient();
    const roster = [record("engineering.standup", { members: ["a"] })];

    await openMailboxes(roster, { client, userId: OWNER, orgId: "org_acme" });
    await openMailboxes(roster, { client, userId: OWNER });

    expect(created).toHaveLength(1);
    expect(deleted).toEqual([]);
  });

  it("refuses an id held by another principal's session instead of deleting it", async () => {
    const { client, deleted, mintEmpty } = sessionClient();
    mintEmpty("engineering.standup", { userId: "u_somebody_else" });

    await expect(
      openMailboxes([record("engineering.standup")], { client, userId: OWNER })
    ).rejects.toThrow(/belonging to "u_somebody_else"/);
    expect(deleted).toEqual([]);
  });

  /**
   * The adopt path's licence is that the occupant "holds no mailbox data". A
   * session of this kind carrying state the schema cannot read is not that: it
   * is data this binder cannot read, and deleting it is the same loss under a
   * different name.
   */
  it("refuses this kind's own session carrying state it cannot read as a mailbox", async () => {
    const { client, deleted, stateOf, mintEmpty } = sessionClient();
    mintEmpty("engineering.standup", { state: { members: [42], instructions: "x" } });

    await expect(
      openMailboxes([record("engineering.standup")], { client, userId: OWNER })
    ).rejects.toThrow(/not a readable mailbox/);

    expect(deleted).toEqual([]);
    expect(stateOf("engineering.standup")).toEqual({ members: [42], instructions: "x" });
  });

  /**
   * A second 409 says the id was retaken between the read and the create — it
   * does NOT say a mailbox is open there. The retaker may be the action path
   * again, so treating it as "someone else opened it" is how `openMailboxes`
   * resolves over a mailbox that is still unbound.
   */
  it("answers a retaken id on boundness again rather than assuming someone opened it", async () => {
    const { client, deleted, stateOf, mintEmpty } = sessionClient({ retakeOnDelete: 1 });
    mintEmpty("engineering.standup");

    await openMailboxes([record("engineering.standup", { members: ["engineering.lead"] })], {
      client,
      userId: OWNER
    });

    // Two rounds: the first lost the id, the second won it. And the mailbox is
    // BOUND at the end, which is the only thing that makes resolving honest.
    expect(deleted).toEqual(["engineering.standup", "engineering.standup"]);
    expect(stateOf("engineering.standup")).toMatchObject({ members: ["engineering.lead"] });
  });

  it("refuses a mailbox whose id keeps being retaken rather than resolving over an unbound one", async () => {
    const { client, deleted, mintEmpty } = sessionClient({ retakeOnDelete: 10 });
    mintEmpty("engineering.standup");

    await expect(
      openMailboxes([record("engineering.standup")], { client, userId: OWNER })
    ).rejects.toThrow(/taken again by an unbound session on each of 3 attempts/);

    // Bounded: three rounds, not a loop.
    expect(deleted).toHaveLength(3);
  });

  it("does not swallow a failure that is not a 409", async () => {
    const client = {
      createSession: vi.fn(async () => {
        throw Object.assign(new Error("Request failed (500)"), { status: 500 });
      }),
      getSession: vi.fn(async () => ({ flowKind: MAILBOX_KIND, userId: OWNER, state: {} })),
      deleteSession: vi.fn(async () => {})
    };
    await expect(
      openMailboxes([record("engineering.standup")], { client, userId: OWNER })
    ).rejects.toThrow(/500/);
  });
});

/**
 * The mailbox door's reading of `flow:`, one row per shape a value can take —
 * through `mailboxInstances` (the build path) and through `kindOf` directly
 * (the reader `openMailboxes` and the inventory writer share).
 *
 * Characterization: every row is what the door does today, and the worker
 * door's twin table in `hire.test.ts` runs the same values. The two doors share
 * one rule for "absent, blank, or not a string", so a change to that rule turns
 * rows red on both tables at once. The mailbox door words every refusal the
 * same way; the worker door words them differently, on purpose.
 */
describe("the mailbox door reads `flow:` (one row per value)", () => {
  const NOT_A_KIND = "declares a `flow:` that is not a kind name";

  it("opens a record with no `flow` key on the built-in `mailbox` kind", () => {
    expect(kindOf({})).toEqual({ kind: MAILBOX_KIND });
    expect(mailboxInstances([record("eng.a")]).map((i) => i.kind)).toEqual([MAILBOX_KIND]);
  });

  it.each([
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
    ["null", null],
    ["an own key holding undefined", undefined],
    ["a number", 42],
    ["an object", {}]
  ])("refuses %s as not a kind name", (_label, value) => {
    expect(kindOf({ flow: value })).toEqual({ problem: NOT_A_KIND });
    expect(() => mailboxInstances([record("eng.a", { flow: value })])).toThrow(NOT_A_KIND);
  });

  it("selects the kind a `flow:` names when that kind was passed", () => {
    expect(kindOf({ flow: "my-mailbox" })).toEqual({ kind: "my-mailbox" });
    const instances = mailboxInstances([record("eng.a", { flow: "my-mailbox" })], {
      kinds: { "my-mailbox": customKind("my-mailbox") }
    });
    expect(instances.map((i) => i.kind)).toEqual(["my-mailbox"]);
  });

  it("does not trim a named kind: a padded name is a kind that was not passed", () => {
    expect(kindOf({ flow: " my-mailbox " })).toEqual({ kind: " my-mailbox " });
    expect(() =>
      mailboxInstances([record("eng.a", { flow: " my-mailbox " })], {
        kinds: { "my-mailbox": customKind("my-mailbox") }
      })
    ).toThrow(/" my-mailbox ".*not passed to mailboxInstances/s);
  });
});
