// @vitest-environment happy-dom
/**
 * The suspension reasons said `human` through core 0.2.0, which stored them.
 * A stop stored under the old reason is a user's stop to the hooks: a `user_*`
 * filter finds it and a stored `human_input` draws as input. A filter written
 * with the old reason matches nothing new, so it throws, naming the new one.
 * `useSuspensions` checks its filter once per distinct value, at the hook's
 * top: the per-item derivation re-runs on every stream update.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { ItemProvenance, OutputItem, SuspensionItem } from "@flow-state-dev/core/items";

import { deriveSuspensions, useSuspensions } from "../src/hooks/useSuspensions";
import { suspensionShape } from "../src/hooks/useSuspensionForm";
import type { SessionView } from "../src/hooks/useSession";

afterEach(cleanup);

const provenance: ItemProvenance = { blockName: "gate", blockInstanceId: "b1", phase: "main" };

function suspension(reason: string, id: string): SuspensionItem {
  return {
    id: `item_${id}`,
    type: "suspension",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance,
    ts: 0,
    suspensionId: id,
    reason,
    message: "Ship it?",
  } as SuspensionItem;
}

function sessionOf(items: OutputItem[]): SessionView {
  return { items, userId: "u1", resumeSuspension: async () => {} } as unknown as SessionView;
}

describe("a suspension under a retired human_* reason, in the hooks", () => {
  it("a user_* filter finds a stop stored under the old reason", () => {
    const items = [suspension("human_approval", "old"), suspension("user_approval", "new"), suspension("custom", "other")];
    const { pending } = deriveSuspensions(items, { reasons: ["user_approval"] });
    expect(pending.map((s) => s.item.suspensionId)).toEqual(["old", "new"]);
  });

  it.each([
    ["human_approval", "user_approval"],
    ["human_input", "user_input"],
  ])("a filter naming %s throws, naming %s", (old, replacement) => {
    expect(() => deriveSuspensions([], { reasons: [old] })).toThrow(
      `useSuspensions: reason "${old}" was renamed. Use "${replacement}".`,
    );
  });

  it("a stored human_input stop with a submit path draws as input, not an approval", () => {
    expect(suspensionShape({ reason: "human_input", allow: ["submit"] })).toBe("question");
    expect(suspensionShape({ reason: "user_input", allow: ["submit"] })).toBe("question");
  });

  it("useSuspensions checks its filter once, not again on each stream update", () => {
    // The check walks the filter; the per-item match only calls `includes`. Count the walks.
    let walks = 0;
    const reasons = ["user_approval"];
    const walk = reasons[Symbol.iterator].bind(reasons);
    Object.defineProperty(reasons, Symbol.iterator, { value: () => ((walks += 1), walk()) });
    const { result, rerender } = renderHook(
      ({ items }: { items: OutputItem[] }) => useSuspensions(sessionOf(items), { reasons }),
      { initialProps: { items: [] as OutputItem[] } },
    );
    rerender({ items: [suspension("user_approval", "a")] });
    rerender({ items: [suspension("user_approval", "a"), suspension("user_approval", "b")] });
    expect(result.current.pending.map((view) => view.item.suspensionId)).toEqual(["a", "b"]);
    expect(walks).toBe(1);
  });

  it("useSuspensions still throws for a retired filter, naming its replacement", () => {
    expect(() => renderHook(() => useSuspensions(sessionOf([]), { reasons: ["human_approval"] }))).toThrow(
      'useSuspensions: reason "human_approval" was renamed. Use "user_approval".',
    );
  });
});
