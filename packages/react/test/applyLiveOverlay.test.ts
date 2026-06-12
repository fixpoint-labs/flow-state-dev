/**
 * Tests for the FIX-739 live overlay applied to collection list reads
 * (`useResourceCollectionList`). Covers status override, tombstone removal, and
 * surfacing live-created topics absent from the fetched window.
 */
import { describe, expect, it } from "vitest";
import type { CollectionItemHandle } from "@flow-state-dev/client";
import { applyLiveOverlay } from "../src/hooks/useResourceCollectionList";

const handle = (topic: string, clientData: unknown): CollectionItemHandle => ({
  topic,
  clientData,
  fetchContent: async () => null,
});

// Stand-in for useResourceCollection's `wrap`: builds a handle from a raw item.
const wrap = (raw: { topic: string; clientData?: unknown }): CollectionItemHandle => ({
  topic: raw.topic,
  clientData: raw.clientData,
  fetchContent: async () => null,
});

describe("applyLiveOverlay", () => {
  const base = [handle("m1", { status: "pending" }), handle("m2", { status: "pending" })];

  it("returns the input reference unchanged when there's no overlay", () => {
    expect(applyLiveOverlay(base, undefined, wrap)).toBe(base);
  });

  it("overrides clientData for overlaid topics", () => {
    const out = applyLiveOverlay(base, { m1: { clientData: { status: "writing" } } }, wrap);
    expect(out.map((i) => [i.topic, i.clientData])).toEqual([
      ["m1", { status: "writing" }],
      ["m2", { status: "pending" }],
    ]);
  });

  it("drops tombstoned topics", () => {
    const out = applyLiveOverlay(base, { m1: { deleted: true } }, wrap);
    expect(out.map((i) => i.topic)).toEqual(["m2"]);
  });

  it("appends live-created topics not in the fetched window", () => {
    const out = applyLiveOverlay(base, { m3: { clientData: { status: "writing" } } }, wrap);
    expect(out.map((i) => i.topic)).toEqual(["m1", "m2", "m3"]);
    expect(out[2]!.clientData).toEqual({ status: "writing" });
  });

  it("does not double-append a topic already in the window", () => {
    const out = applyLiveOverlay(base, { m1: { clientData: { status: "published" } } }, wrap);
    expect(out.filter((i) => i.topic === "m1")).toHaveLength(1);
  });
});
