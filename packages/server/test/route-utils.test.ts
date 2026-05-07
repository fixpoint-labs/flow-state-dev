/**
 * Tests for the resource-snapshot serializer (FIX-427).
 *
 * Covers the lazy-collection shape: `count` always emitted for client-visible
 * collections; `prefetched` populated only when `prefetchWindow > 0`; per-item
 * `clientData` gated by `client.state.read`; legacy `items` map only via the
 * `includeItems` escape hatch and capped at INCLUDE_ITEMS_CAP.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineResource } from "@flow-state-dev/core/types";
import { defineResourceCollection } from "@flow-state-dev/core/types";
import {
  IncludeItemsCapExceeded,
  INCLUDE_ITEMS_CAP,
  buildResourceSnapshot,
} from "../src/routes/route-utils";

function makeArtifactsCollection(opts: {
  prefetchWindow?: number;
  clientState?: { read?: boolean };
  clientContent?: { read?: boolean; prefetch?: boolean };
  clientData?: (state: { title?: string }) => unknown;
} = {}) {
  return defineResourceCollection({
    pattern: "artifacts/*",
    scope: "session",
    stateSchema: z.object({ title: z.string().optional() }),
    prefetchWindow: opts.prefetchWindow,
    client: {
      content: opts.clientContent,
      state: opts.clientState,
      data: opts.clientData as never,
    },
  });
}

const persistedFor = (n: number, prefix = "artifacts") => {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    out[`${prefix}/item-${String(i).padStart(3, "0")}`] = { title: `Item ${i}` };
  }
  return out;
};

describe("buildResourceSnapshot — FIX-427 collection shape", () => {
  it("emits only `count` when prefetchWindow is unset (default lazy)", async () => {
    const out = await buildResourceSnapshot({
      configs: { artifacts: makeArtifactsCollection({ clientState: { read: true } }) },
      persisted: persistedFor(10),
    });
    expect(out).toEqual({ artifacts: { count: 10 } });
  });

  it("emits prefetched topics-only when state.read is false", async () => {
    const out = await buildResourceSnapshot({
      configs: {
        artifacts: makeArtifactsCollection({
          prefetchWindow: 3,
          clientContent: { read: true },
          // state.read intentionally omitted
        }),
      },
      persisted: persistedFor(10),
    });
    expect(out?.artifacts).toEqual({
      count: 10,
      prefetched: [
        { topic: "artifacts/item-000" },
        { topic: "artifacts/item-001" },
        { topic: "artifacts/item-002" },
      ],
    });
  });

  it("includes per-item clientData in prefetched when state.read is true", async () => {
    const out = await buildResourceSnapshot({
      configs: {
        artifacts: makeArtifactsCollection({
          prefetchWindow: 2,
          clientState: { read: true },
          clientData: (s) => ({ title: s.title }),
        }),
      },
      persisted: persistedFor(5),
    });
    expect(out?.artifacts).toEqual({
      count: 5,
      prefetched: [
        { topic: "artifacts/item-000", clientData: { title: "Item 0" } },
        { topic: "artifacts/item-001", clientData: { title: "Item 1" } },
      ],
    });
  });

  it("returns all items when prefetchWindow exceeds total", async () => {
    const out = await buildResourceSnapshot({
      configs: {
        artifacts: makeArtifactsCollection({
          prefetchWindow: 50,
          clientState: { read: true },
        }),
      },
      persisted: persistedFor(3),
    });
    const entry = out?.artifacts as { count: number; prefetched: unknown[] };
    expect(entry.count).toBe(3);
    expect(entry.prefetched).toHaveLength(3);
  });

  it("omits client-less collections when includeInternal is false", async () => {
    const internal = defineResourceCollection({
      pattern: "secrets/*",
      scope: "session",
      stateSchema: z.object({}),
    });
    const out = await buildResourceSnapshot({
      configs: { secrets: internal },
      persisted: { "secrets/key": {} },
    });
    expect(out).toBeUndefined();
  });

  it("includes legacy items map only when includeItems is set", async () => {
    const out = await buildResourceSnapshot({
      configs: {
        artifacts: makeArtifactsCollection({
          clientState: { read: true },
          clientData: (s) => ({ title: s.title }),
        }),
      },
      persisted: persistedFor(2),
      includeItems: true,
    });
    const entry = out?.artifacts as { count: number; items: Record<string, unknown> };
    expect(entry.count).toBe(2);
    expect(entry.items).toEqual({
      "artifacts/item-000": { clientData: { title: "Item 0" } },
      "artifacts/item-001": { clientData: { title: "Item 1" } },
    });
  });

  it("throws IncludeItemsCapExceeded when includeItems exceeds the cap", async () => {
    const persisted = persistedFor(INCLUDE_ITEMS_CAP + 1);
    await expect(
      buildResourceSnapshot({
        configs: { artifacts: makeArtifactsCollection({ clientState: { read: true } }) },
        persisted,
        includeItems: true,
      })
    ).rejects.toBeInstanceOf(IncludeItemsCapExceeded);
  });

  it("emits count = 0 with no prefetched for an empty collection", async () => {
    const out = await buildResourceSnapshot({
      configs: { artifacts: makeArtifactsCollection({ prefetchWindow: 5, clientState: { read: true } }) },
      persisted: {},
    });
    expect(out?.artifacts).toEqual({ count: 0, prefetched: [] });
  });

  it("preserves single-resource shape (regression)", async () => {
    const out = await buildResourceSnapshot({
      configs: {
        profile: defineResource({
          scope: "session",
          stateSchema: z.object({ name: z.string().default("anon") }),
          client: { data: (s) => ({ name: (s as { name: string }).name }) },
        }),
      },
      persisted: { profile: { name: "Ada" } },
    });
    expect(out).toEqual({ profile: { clientData: { name: "Ada" } } });
  });
});
