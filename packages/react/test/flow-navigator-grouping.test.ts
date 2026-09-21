/**
 * V2 / BR-1, BR-2, BR-5, BR-6 — the kind level, which is the genuinely new one.
 *
 * The shape being replaced is a flat list over instances, where two copies of
 * one kind are two top-level rows. Every assertion here fails against that
 * shape, which is what makes it a check rather than a description.
 */
import { describe, expect, it } from "vitest";
import type { FlowListEntry } from "@flow-state-dev/client";
import { groupFlowsIntoSections } from "../src/components/flow-navigator/grouping";

const entry = (
  id: string,
  kind: string,
  cardinality: FlowListEntry["cardinality"]
): FlowListEntry => ({ id, kind, cardinality, requireUser: false, actions: [] });

const flows: FlowListEntry[] = [
  entry("chat", "chat", "singleton"),
  entry("engineer-a", "agent", "collection"),
  entry("engineer-b", "agent", "collection"),
];

const sections = [
  { label: "Channels", kinds: ["chat"] },
  { label: "Seats", kinds: ["agent"] },
];

describe("groupFlowsIntoSections", () => {
  it("puts two instances of one collection kind under ONE kind row", () => {
    const [, seats] = groupFlowsIntoSections(flows, sections);

    // A flat list over instances gives two rows here, which is the shape being
    // replaced.
    expect(seats!.kinds).toHaveLength(1);
    expect(seats!.kinds[0]!.kind).toBe("agent");
    expect(seats!.kinds[0]!.instances.map((i) => i.id)).toEqual([
      "engineer-a",
      "engineer-b",
    ]);
  });

  it("draws no instance level under a singleton kind, and makes the kind row the leaf", () => {
    const [channels] = groupFlowsIntoSections(flows, sections);
    const group = channels!.kinds[0]!;

    expect(group.cardinality).toBe("singleton");
    expect(group.instances).toEqual([]);
    // Its address IS its kind, so there is no copy to pick.
    expect(group.leaf).toEqual({
      kind: "chat",
      address: "chat",
      cardinality: "singleton",
    });
  });

  it("gives a collection kind no leaf of its own — its leaves are its instances", () => {
    const [, seats] = groupFlowsIntoSections(flows, sections);

    expect(seats!.kinds[0]!.leaf).toBeNull();
  });

  it("renders a section whose kinds the server does not have as empty, leaving the others alone", () => {
    const views = groupFlowsIntoSections(flows, [
      { label: "Channels", kinds: ["chat"] },
      { label: "Warehouses", kinds: ["warehouse"] },
    ]);

    expect(views[1]!.kinds).toEqual([]);
    expect(views[0]!.kinds).toHaveLength(1);
  });

  it("derives depth from the flow rather than from the section", () => {
    // Same section definition, different server answer: the depth follows the
    // flow. Nothing in the section said which shape to expect.
    const asCollection = groupFlowsIntoSections(
      [entry("chat", "chat", "collection")],
      [{ label: "Channels", kinds: ["chat"] }]
    );

    expect(asCollection[0]!.kinds[0]!.leaf).toBeNull();
    expect(asCollection[0]!.kinds[0]!.instances.map((i) => i.id)).toEqual(["chat"]);
  });

  it("keeps a kind in one section out of another", () => {
    const views = groupFlowsIntoSections(flows, [
      { label: "Channels", kinds: ["chat"] },
      { label: "Seats", kinds: ["agent"] },
    ]);

    expect(views[0]!.kinds.map((k) => k.kind)).toEqual(["chat"]);
    expect(views[1]!.kinds.map((k) => k.kind)).toEqual(["agent"]);
  });
});
