/**
 * The relay door (FIX-1230) — which handler a message may reach, and whether it
 * may reach one at all.
 *
 * These are unit tests over the decision function, which is where the whole
 * security property lives. `relay-send.test.ts` drives the same door on the real
 * dispatch path; this file is the exhaustive table, because ten branches through
 * an HTTP round-trip apiece is a suite nobody runs.
 *
 * **Nine of the ten cases below assert a refusal, and the tenth is the reason the
 * other nine are not vacuous.** A door test suite made only of refusals proves
 * the door closes and says nothing about it opening — so the success cases are
 * here deliberately, and they are what would fail if someone "fixed" a refusal by
 * closing the door entirely.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type { ActionCore, FlowInstance } from "@flow-state-dev/core/types";
import { resolveRelayDoor } from "../../src/execution/relay-door";
import type { SessionKind } from "../../src/stores/types";

const block = (name: string) =>
  handler({
    name,
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.object({}),
    execute: async () => ({})
  });

const declaredHandler = block("declared");
const publicAction = block("public");
const durableAction = block("durable");

/** The recipient's flow, as much of it as the door reads. */
function flowWith(options: {
  declared?: boolean;
  publicKinds?: string[];
  durableKinds?: string[];
}): Pick<FlowInstance, "actions" | "relay"> {
  const actions: Record<string, ActionCore> = {};
  for (const kind of options.publicKinds ?? []) {
    actions[kind] = { block: publicAction };
  }
  for (const kind of options.durableKinds ?? []) {
    actions[kind] = { block: durableAction, durable: true };
  }
  return {
    actions: actions as FlowInstance["actions"],
    ...(options.declared === true
      ? { relay: { on: { question: { block: declaredHandler, input: (m) => m.payload } } } }
      : {})
  };
}

function ask(options: {
  flow: Pick<FlowInstance, "actions" | "relay">;
  kind?: string;
  sender?: SessionKind | undefined | null;
  recipient?: SessionKind | undefined | null;
}) {
  // Key presence, not `?? "top-level"`. An explicit `undefined` is the case
  // under test — a legacy record — and a nullish default would silently turn
  // every one of those assertions into the top-level case it is contrasted with.
  return resolveRelayDoor({
    flow: options.flow,
    kind: options.kind ?? "question",
    senderKind: "sender" in options ? options.sender : "top-level",
    recipientKind: "recipient" in options ? options.recipient : "top-level"
  });
}

describe("the relay door", () => {
  // ---- The cases that OPEN it. Without these the suite is vacuous. ----

  it("resolves a declared binding for a top-level recipient with no public action of that name — the headline case", () => {
    const verdict = ask({ flow: flowWith({ declared: true }) });

    expect(verdict).toMatchObject({ ok: true, door: "declared" });
    // The core it resolved is the DECLARED handler, not something that merely
    // typechecks as one — this is what a "the declared surface is reachable"
    // assertion has to name to mean anything.
    expect(verdict.ok && verdict.core.block.name).toBe("declared");
  });

  it("still resolves the declared binding when the SENDER is a workstream — the confinement does not break what it protects", () => {
    // The second axis narrows only the agent's *undeclared* reach. If it also
    // closed the declared door, the whole feature would be unreachable from the
    // background job it was written for, and every refusal test would still pass.
    const verdict = ask({ flow: flowWith({ declared: true }), sender: "workstream" });

    expect(verdict).toMatchObject({ ok: true, door: "declared" });
  });

  it("resolves the declared binding for a WORKSTREAM recipient", () => {
    const verdict = ask({ flow: flowWith({ declared: true }), recipient: "workstream" });

    expect(verdict).toMatchObject({ ok: true, door: "declared" });
  });

  it("falls through to a public action between two top-level sessions", () => {
    const verdict = ask({
      flow: flowWith({ publicKinds: ["question"] }),
      kind: "question"
    });

    expect(verdict).toMatchObject({ ok: true, door: "action" });
    expect(verdict.ok && verdict.core.block.name).toBe("public");
  });

  it("treats a sibling session as addressable at both ends", () => {
    // Nothing mints a sibling today; the branch exists because parentage stops
    // discriminating the moment one does. Pinned so a future writer inherits the
    // decision rather than re-deriving it.
    const verdict = ask({
      flow: flowWith({ publicKinds: ["question"] }),
      sender: "sibling",
      recipient: "sibling"
    });

    expect(verdict).toMatchObject({ ok: true, door: "action" });
  });

  // ---- The cases that CLOSE it. ----

  it("refuses when the RECIPIENT is a workstream and no binding is declared — even naming a real public action", () => {
    const verdict = ask({
      flow: flowWith({ publicKinds: ["question"] }),
      recipient: "workstream"
    });

    expect(verdict).toMatchObject({ ok: false, refused: "recipient-not-addressable" });
  });

  it("refuses when the SENDER is a workstream and no binding is declared — the axis a recipient-only guard leaves open", () => {
    // Round one of this design confined the recipient only, which left a
    // background job able to reach an *undeclared* public action on a peer. The
    // two properties read alike: one is about whose surface is exposed, the other
    // about who may reach out.
    const verdict = ask({
      flow: flowWith({ publicKinds: ["question"] }),
      sender: "workstream",
      recipient: "top-level"
    });

    expect(verdict).toMatchObject({ ok: false, refused: "recipient-not-addressable" });
  });

  it("refuses a legacy RECIPIENT record — one written before session kinds existed", () => {
    const verdict = ask({ flow: flowWith({ publicKinds: ["question"] }), recipient: undefined });

    expect(verdict).toMatchObject({ ok: false, refused: "recipient-not-addressable" });
  });

  it("refuses a legacy SENDER record", () => {
    const verdict = ask({ flow: flowWith({ publicKinds: ["question"] }), sender: undefined });

    expect(verdict).toMatchObject({ ok: false, refused: "recipient-not-addressable" });
  });

  it("refuses a record whose kind reads back as null, not just undefined", () => {
    // A store that nulls absent keys hands back `null`. Both mean unclassified,
    // and a `=== undefined` guard would let one of them through (BP-030).
    const verdict = ask({ flow: flowWith({ publicKinds: ["question"] }), recipient: null });

    expect(verdict).toMatchObject({ ok: false, refused: "recipient-not-addressable" });
  });

  it("refuses a legacy record at EITHER end even when a matching binding IS declared — the ordering rule", () => {
    // This is the whole of why the absent-kind check runs first. Placed among the
    // fallthrough gates it would let a legacy sender or recipient reach a declared
    // handler, while the contract says absence is refused unconditionally.
    // Fail-closed that covers one of two doors is not fail-closed.
    expect(ask({ flow: flowWith({ declared: true }), recipient: undefined })).toMatchObject({
      ok: false,
      refused: "recipient-not-addressable"
    });
    expect(ask({ flow: flowWith({ declared: true }), sender: undefined })).toMatchObject({
      ok: false,
      refused: "recipient-not-addressable"
    });
  });

  it("refuses no-relay-door when the kind matches neither a binding nor a public action", () => {
    // Unresolved, this reaches `resolveActionCore` and THROWS — handing a caller
    // promised a returned refusal an exception instead, which breaks the
    // taxonomy on an ordinary path rather than an exotic one.
    const verdict = ask({
      flow: flowWith({ declared: true, publicKinds: ["other"] }),
      kind: "nothing-declares-this"
    });

    expect(verdict).toMatchObject({ ok: false, refused: "no-relay-door" });
  });

  it("refuses durable-action when the fallthrough lands on a durable public action — with its OWN code", () => {
    // Deliberately distinguishable from the security refusals. An app author
    // whose durable action stopped receiving messages must be able to tell that
    // from being denied; collapsing the two makes a supported configuration
    // undiagnosable.
    const verdict = ask({
      flow: flowWith({ durableKinds: ["question"] })
    });

    expect(verdict).toMatchObject({ ok: false, refused: "durable-action" });
  });

  it("does NOT refuse a durable action reached through a DECLARED binding of the same name", () => {
    // Rule 4 narrows the fallthrough, not the declared door — a binding's own
    // durability is refused at flow construction instead, with a message an
    // author can act on. Two checks over different sets, and this pins that the
    // resolution-time one has not quietly widened to cover both.
    const flow = flowWith({ declared: true, durableKinds: ["question"] });
    const verdict = ask({ flow });

    expect(verdict).toMatchObject({ ok: true, door: "declared" });
  });
});
