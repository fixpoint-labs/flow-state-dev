/**
 * V1 — the cardinality branch, written once (FIX-1477 S1).
 *
 * Every assertion here checks the ABSENCE of the other key as well as the
 * presence of the right one. A helper that sent both would satisfy a
 * presence-only test and then silently over-filter on the server, which
 * answers a `flowId` + `flowKind` pair with the intersection.
 */
import { describe, expect, it } from "vitest";
// Through the package entry, not the module file: the helper is only useful to
// the two hosts if it is actually exported.
import { sessionQueryFor, type FlowListEntry } from "../src";

const entry = (
  id: string,
  kind: string,
  cardinality: FlowListEntry["cardinality"]
): FlowListEntry => ({
  id,
  kind,
  cardinality,
  requireUser: false,
  actions: [],
});

const flows: FlowListEntry[] = [
  entry("engineer-a", "agent", "collection"),
  entry("engineer-b", "agent", "collection"),
  entry("chat", "chat", "singleton"),
];

describe("sessionQueryFor", () => {
  it("files a collection member's sessions under its exact id, and sends no kind", () => {
    const query = sessionQueryFor("engineer-a", flows);

    expect(query).toEqual({ flowId: "engineer-a" });
    expect("flowKind" in query).toBe(false);
  });

  it("files a singleton's sessions under its kind, and sends no instance id", () => {
    const query = sessionQueryFor("chat", flows);

    expect(query).toEqual({ flowKind: "chat" });
    expect("flowId" in query).toBe(false);
  });

  it("reads an address the flow list has not loaded yet as a kind", () => {
    // `useFlow` calls this before its own `listFlows` resolves, and the kind
    // filter is what every flow was before collection cardinality existed.
    // Throwing or guessing an instance id here regresses that mount path.
    expect(sessionQueryFor("chat", [])).toEqual({ flowKind: "chat" });
    expect("flowId" in sessionQueryFor("chat", [])).toBe(false);
  });

  it("matches on the address, not on the kind two instances share", () => {
    // `kind` is "agent" for both members; only `id` tells the copies apart.
    expect(sessionQueryFor("agent", flows)).toEqual({ flowKind: "agent" });
    expect(sessionQueryFor("engineer-b", flows)).toEqual({ flowId: "engineer-b" });
  });
});
