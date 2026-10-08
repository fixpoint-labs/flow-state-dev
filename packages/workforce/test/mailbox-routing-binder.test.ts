/**
 * The `routing:` key, as the binder reads it.
 *
 * `routing:` is the sixth key a `MAILBOX.md` declares, with one subkey,
 * `fallback:`, naming the member who takes a post the route cannot place. It is
 * read off the file at every boot and built onto the kind, like `boards:`, and
 * never written into the mailbox's session, so everything that can be wrong
 * with it is wrong at boot, and refused there, naming the mailbox and the key.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1610/BUSINESS-RULES.md`, V1):
 *   BR-15 `routing:` with a `fallback:` member, on a kind built with a route, binds;
 *   BR-16 a fallback outside `members:`, no `fallback:`, an unknown subkey, or a
 *         `routing:` that is not a mapping, refuses;
 *   BR-17 `routing:` on a kind built without a route refuses;
 *   BR-28 a fallback whose member has no seat, among those the route was built
 *         with, that hears posts refuses.
 * BR-18 and BR-19 need a running host and live with the route's own checks
 * (`mailbox-route.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { mockEvaluationModel } from "@flow-state-dev/testing";
import {
  mailboxInstances,
  defineMailboxFlow,
  routeByPurpose,
  wakeMemberSeats,
  workerConfigSchema,
  type MailboxManifest
} from "../src/index";
import { mintSeats } from "../src/hire";
import { workerDoor } from "./worker-door";

/** A kind of the app's own that takes notes when asked and hears no posts. */
const note = defineFlow({
  kind: "note",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: { ...workerDoor, take: { block: handler({ name: "note-take", execute: () => ({}) }) } }
} as never);

const seats = mintSeats(
  [
    { id: "support.devices", declared: { description: "Printers, laptops, phones and wifi." }, body: "Devices." },
    { id: "support.general", declared: { description: "Anything that fits no one else." }, body: "General." },
    { id: "support.notes", declared: { description: "Takes notes.", flow: "note" }, body: "Notes." }
  ],
  { workerFlows: { note: note as never } }
);

const route = routeByPurpose(seats, { model: mockEvaluationModel() });

/** The built-in mailbox kind with the wake and the route: a routed host's kind. */
const routedKind = defineMailboxFlow({ notify: wakeMemberSeats(seats), route });

function record(id: string, declared: Record<string, unknown>): MailboxManifest {
  return { id, declared, body: "Ask the support team." };
}

const MEMBERS = ["support.devices", "support.general", "support.notes"];

/** The refusal `mailboxInstances` throws for this roster, or undefined when it binds. */
function refusal(manifests: MailboxManifest[], kind = routedKind): string | undefined {
  try {
    mailboxInstances(manifests, { kinds: { mailbox: kind as never } });
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

describe("routing: in a MAILBOX.md", () => {
  it("binds a fallback that is a member with a seat that hears posts, on a kind built with a route (BR-15)", () => {
    expect(
      refusal([record("support.help", { members: MEMBERS, routing: { fallback: "support.general" } })])
    ).toBeUndefined();
  });

  it("names the route's members: the seats passed that hear posts, by the id a mailbox lists", () => {
    expect([...route.members].sort()).toEqual(["support.devices", "support.general"]);
  });

  it("refuses a fallback that is not among the mailbox's members, naming the mailbox and the member (BR-16)", () => {
    const message = refusal([
      record("support.help", { members: ["support.devices", "support.general"], routing: { fallback: "support.sales" } })
    ]);
    expect(message).toMatch(/mailbox "support\.help"/);
    expect(message).toMatch(/`routing:`/);
    expect(message).toMatch(/"support\.sales"/);
    expect(message).toMatch(/not among its `members:`/);
  });

  it("refuses a routing: with no fallback: (BR-16)", () => {
    const message = refusal([record("support.help", { members: MEMBERS, routing: {} })]);
    expect(message).toMatch(/mailbox "support\.help"/);
    expect(message).toMatch(/`fallback:`/);
  });

  it("refuses a subkey routing: does not declare (BR-16)", () => {
    const message = refusal([
      record("support.help", { members: MEMBERS, routing: { fallback: "support.general", model: "x" } })
    ]);
    expect(message).toMatch(/mailbox "support\.help"/);
    expect(message).toMatch(/`model`/);
    expect(message).toMatch(/`routing:` declares only `fallback:`/);
  });

  it("refuses a routing: that is not a mapping (BR-16)", () => {
    for (const routing of ["support.general", ["support.general"], null]) {
      const message = refusal([record("support.help", { members: MEMBERS, routing })]);
      expect(message, JSON.stringify(routing)).toMatch(/mailbox "support\.help" — declares a `routing:` that is not a mapping/);
    }
  });

  it("refuses routing: on a kind built without a route, the built-in included (BR-17)", () => {
    const withoutRoute = refusal(
      [record("support.help", { members: MEMBERS, routing: { fallback: "support.general" } })],
      defineMailboxFlow({ notify: wakeMemberSeats(seats) })
    );
    expect(withoutRoute).toMatch(/mailbox "support\.help"/);
    expect(withoutRoute).toMatch(/`routing:`/);
    expect(withoutRoute).toMatch(/built without a route/);

    // With no kinds passed at all, the seeded built-in has no route either.
    expect(() =>
      mailboxInstances([record("support.help", { members: MEMBERS, routing: { fallback: "support.general" } })])
    ).toThrow(/built without a route/);
  });

  it("refuses routing: on a kind the app wrote itself (BR-17)", () => {
    const custom = defineFlow({
      kind: "briefing",
      cardinality: "singleton",
      actions: { post: { block: handler({ name: "briefing-post", execute: () => ({}) }) } }
    });
    expect(() =>
      mailboxInstances(
        [record("support.help", { flow: "briefing", members: MEMBERS, routing: { fallback: "support.general" } })],
        { kinds: { mailbox: routedKind as never, briefing: custom as never } }
      )
    ).toThrow(/mailbox "support\.help" — declares `routing:` and runs on mailbox kind "briefing", which was built without a route/);
  });

  it("refuses a fallback whose member has no seat among the route's that hears posts, naming it (BR-28)", () => {
    const message = refusal([record("support.help", { members: MEMBERS, routing: { fallback: "support.notes" } })]);
    expect(message).toMatch(/mailbox "support\.help"/);
    expect(message).toMatch(/"support\.notes"/);
    expect(message).toMatch(/no seat the route was built with hears posts for it/);
  });

  it("leaves a mailbox with no routing: line unrouted on a routed kind, binding as before (BR-18)", () => {
    expect(refusal([record("support.lounge", { members: MEMBERS })])).toBeUndefined();
  });

  it("names every routed mailbox's problem in one run", () => {
    const message = refusal([
      record("support.a", { members: MEMBERS, routing: { fallback: "support.sales" } }),
      record("support.b", { members: MEMBERS, routing: { fallback: "support.notes" } })
    ]);
    expect(message).toMatch(/refused 2 of 2 mailboxes/);
  });
});

describe("routeByPurpose", () => {
  it("refuses to be built without a model", () => {
    expect(() => routeByPurpose(seats, {} as never)).toThrow(/model/);
  });
});

describe("defineMailboxFlow({ route })", () => {
  it("refuses a route no routeByPurpose call made", () => {
    expect(() => defineMailboxFlow({ notify: wakeMemberSeats(seats), route: { members: [] } as never })).toThrow(
      /routeByPurpose/
    );
  });

  it("refuses a route with no notify slot to deliver to", () => {
    expect(() => defineMailboxFlow({ route })).toThrow(/notify/);
  });

  it("keeps its route when the binder rebuilds it holding boards", () => {
    const kind = routedKind.withBoards(["support.help.escalations"]);
    expect(
      refusal(
        [
          record("support.help", {
            members: MEMBERS,
            boards: ["escalations"],
            routing: { fallback: "support.general" }
          })
        ],
        kind
      )
    ).toBeUndefined();
  });
});
