/**
 * A coordinator request opened while the judgment turn's record was named `handOffs` (retired-name-refusal)
 * (BP-030), and resumed since, still reads what that turn dispatched. Request state is not parsed on read, so `withDispatches` is the only
 * thing between the old record and the judgment turn's `post.dispatches`: miss it and
 * the turn reports it dispatched to no delegate, and the next dispatch drops the ones
 * before it.
 */
import { describe, expect, it } from "vitest";
import { withDispatches, type PostState } from "../src/coordinator/coordinator-flow";

const routed = { worker: "eng.reviewer", outcome: "delivered" } as PostState["dispatches"][number];

function post(fields: Record<string, unknown>): PostState {
  return {
    messageRequestId: "p1",
    body: "review this",
    from: "alice",
    round: 0,
    coordinator: "eng.lead",
    filingSessionId: "s1",
    recent: [],
    policy: "judgment",
    defaults: { delegates: [] },
    ...fields
  } as PostState;
}

describe("a post stored before the field was renamed", () => {
  it("reads its old record as dispatches, and drops the old key", () => {
    const stored = post({ handOffs: [routed] }); // retired-name-refusal: BP-030
    const read = withDispatches(stored);
    expect(read.dispatches).toEqual([routed]);
    expect(read).not.toHaveProperty("handOffs"); // retired-name-refusal: BP-030
  });

  it("appends a later dispatch after the ones the old record holds", () => {
    const read = withDispatches(post({ handOffs: [routed] })); // retired-name-refusal: BP-030
    const next = { worker: "eng.builder", outcome: "delivered" } as PostState["dispatches"][number];
    expect([...read.dispatches, next].map((d) => d.worker)).toEqual(["eng.reviewer", "eng.builder"]);
  });

  it("leaves a post written under the new name untouched", () => {
    const current = post({ dispatches: [routed] });
    expect(withDispatches(current)).toBe(current);
  });
});
