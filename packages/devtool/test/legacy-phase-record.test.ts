/**
 * A stored item written BEFORE the side-chain rename still reads (FIX-766).
 *
 * FIX-766 changed the persisted tier value from `phase: "work"` to
 * `phase: "sideChain"` and deliberately shipped **no** BP-030 compatibility
 * shim. That call rests on a specific, checked claim: nothing reads this value
 * to make a decision. Crash recovery never looks at it — `request-recovery.ts`
 * contains zero references to `phase` — so its only consumer is this trace
 * tree, which uses it to decide whether to draw a badge.
 *
 * "No shim" therefore has to mean *degrades*, not *breaks*. This pins the
 * boundary BP-030 actually cares about (BP-035's legacy path): an old record
 * flows through the reader without throwing, keeps every other field, and
 * simply renders unbadged because its phase is no longer a value the badge
 * recognises. If this ever throws, decision 2's premise is wrong and the shim
 * is owed after all.
 *
 * This file is the ONE audited place the retired spelling may still appear —
 * see `EXEMPT_FILES` in `scripts/validate-side-chain-vocabulary.mjs`. It is
 * exempt precisely because its subject is the old spelling.
 */
import { describe, expect, it } from "vitest";
import { buildTraceTree } from "../src/react/lib/trace-tree";
import { sideChainTaskCount } from "../src/react/lib/side-chain-task-count";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestGroup } from "../src/react/components/workspace/stream-view";

function makeItem(
  id: string,
  itemIndex: number,
  provenance: { blockName: string; blockInstanceId: string; phase: string }
): OutputItem {
  return {
    id,
    type: "message",
    status: "completed",
    requestId: "req-1",
    itemIndex,
    ts: Date.now(),
    provenance
  } as unknown as OutputItem;
}

function group(items: OutputItem[]): RequestGroup {
  return {
    requestId: "req-1",
    action: "sendMessage",
    status: "completed",
    startedAt: Date.now(),
    items
  };
}

/**
 * An item log as the pre-rename code would have persisted it.
 *
 * The provenance is written INLINE rather than passed through a builder's
 * parameters on purpose: `phase: "work"` in a property position is a shape
 * `validate-side-chain-vocabulary.mjs` recognises, so this file genuinely needs
 * the exemption it is granted. Threaded through a helper argument instead, the
 * check would not see it and the exemption would be decoration.
 */
function legacyItems(): OutputItem[] {
  return [
    makeItem("i1", 0, {
      blockName: "main-block",
      blockInstanceId: "req-1:main[0]:1",
      phase: "main"
    }),
    // The retired spelling, exactly as a pre-rename run wrote it.
    makeItem("i2", 1, {
      blockName: "legacy-side-chain",
      blockInstanceId: "req-1:work[1]:1",
      phase: "work"
    })
  ];
}

describe("a record written before the side-chain rename", () => {
  it("builds a trace tree without throwing", () => {
    expect(() => buildTraceTree([group(legacyItems())])).not.toThrow();
  });

  it("keeps the block, its name and its position — only the badge is lost", () => {
    const tree = buildTraceTree([group(legacyItems())]);
    const blocks = tree[0]!.children;
    const legacy = blocks.find((n) => n.blockName === "legacy-side-chain");

    expect(legacy).toBeDefined();
    // Read back verbatim: the tree does not coerce or validate the value, which
    // is why an unknown phase is survivable at all.
    expect(legacy?.phase).toBe("work");
    // …and `"work"` is not `"sideChain"`, so `trace-view` renders no SC badge.
    // That is the whole accepted cost on the DevTool side.
    expect(legacy?.phase).not.toBe("sideChain");
  });

  it("still recognises a current record alongside the legacy one", () => {
    const mixed = [
      ...legacyItems(),
      makeItem("i3", 2, {
        blockName: "current-side-chain",
        blockInstanceId: "req-1:sideChain[2]:1",
        phase: "sideChain"
      })
    ];
    const tree = buildTraceTree([group(mixed)]);
    const blocks = tree[0]!.children;

    expect(blocks.find((n) => n.blockName === "current-side-chain")?.phase).toBe("sideChain");
    expect(blocks.find((n) => n.blockName === "legacy-side-chain")?.phase).toBe("work");
  });
});

/**
 * The side-chain COUNT is a second persisted field the rename moved, and its
 * failure is quieter than the badge's: the trace tree drops any status row with
 * neither a message nor a count, so reading only the new spelling makes a
 * pre-upgrade or replayed row **disappear** rather than render wrong. Mixed
 * versions then lose the only sign that draining is happening.
 */
describe("the side-chain count on a status item", () => {
  const statusRow = (provenanceless: Record<string, unknown>) =>
    ({ type: "status", message: "", ...provenanceless }) as never;

  it("reads the current spelling", () => {
    expect(sideChainTaskCount(statusRow({ sideChainTasks: 2 }))).toBe(2);
  });

  it("reads a row written before the rename", () => {
    expect(sideChainTaskCount(statusRow({ backgroundTasks: 3 }))).toBe(3);
  });

  it("reads a legacy ZERO, which is the drain-complete signal", () => {
    // `?? ` on the value rather than a truthiness check: 0 is meaningful here
    // and is exactly the row a naive shim drops.
    expect(sideChainTaskCount(statusRow({ backgroundTasks: 0 }))).toBe(0);
  });

  it("prefers the current spelling when both are present", () => {
    expect(sideChainTaskCount(statusRow({ sideChainTasks: 1, backgroundTasks: 9 }))).toBe(1);
  });

  it("returns undefined when the row carries no count at all", () => {
    expect(sideChainTaskCount(statusRow({}))).toBeUndefined();
  });

  it("keeps a legacy status row in the trace tree instead of dropping it", () => {
    const items = [
      makeItem("s1", 0, {
        blockName: "seq",
        blockInstanceId: "req-1:main[0]:1",
        phase: "main",
      }),
    ] as unknown as Array<Record<string, unknown>>;
    // A structural status row as a pre-upgrade engine wrote it: empty message,
    // count under the retired name.
    items.push({
      id: "s2",
      type: "status",
      message: "",
      backgroundTasks: 2,
      status: "completed",
      requestId: "req-1",
      itemIndex: 1,
      ts: Date.now(),
      provenance: { blockName: "seq", blockInstanceId: "req-1:main[0]:1", phase: "main" },
    });

    const tree = buildTraceTree([group(items as never)]);
    const rendered = JSON.stringify(tree);
    expect(rendered).toContain("s2");
  });
});
