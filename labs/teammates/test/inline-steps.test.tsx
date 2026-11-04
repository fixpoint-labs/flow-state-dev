// @vitest-environment happy-dom
/**
 * A worker's tool steps show in its conversation during its turn (FIX-2393):
 * a run of them is one line, open while a step runs and folded once the run
 * is done, and a step whose result says it failed reads "(failed)" in words,
 * drawn in the lab's red. The entry is the adapter's own, over real-shaped items.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { toEntries, type ConversationEntry } from "../src/adapter";
import { Entry } from "../src/components/Entry";
import { lookOf } from "../src/lib/looks";

afterEach(cleanup);

const read = (id: string, path: string, status: string, output?: unknown) => ({
  id,
  type: "tool_output",
  status,
  requestId: "r1",
  toolCall: { name: "readProjectSource", arguments: JSON.stringify({ path }) },
  ...(output === undefined ? {} : { output }),
});
const ok = (path: string) => ({ kind: "read", status: "ok", path, content: "x" });

/** The conversation's one entry for `items`, drawn. */
function draw(items: unknown[]): HTMLElement {
  const [entry] = toEntries(items as never, new Set()) as ConversationEntry[];
  return render(<Entry entry={entry!} workerName="researcher" nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} />).container;
}

describe("a worker's steps inline", () => {
  it("draws a running run open, naming the file in flight", () => {
    const run = draw([read("t1", "docs/a.md", "completed", ok("docs/a.md")), read("t2", "docs/b.md", "in_progress")]).querySelector("details")!;
    expect(run.open).toBe(true);
    expect(run.querySelector("summary")?.textContent).toBe("Read docs/b.md…");
    expect([...run.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["· Read docs/a.md", "· Read docs/b.md…"]);
  });

  it("folds the run once it is done", () => {
    const run = draw([read("t1", "docs/a.md", "completed", ok("docs/a.md")), read("t2", "docs/b.md", "completed", ok("docs/b.md"))]).querySelector("details")!;
    expect(run.open).toBe(false);
    expect(run.querySelector("summary")?.textContent).toBe("Read 2 files");
  });

  it("says a refused read failed, in words and in the lab's red", () => {
    const refused = { kind: "refused", reason: "not-a-member", message: "Not a member." };
    const line = draw([read("t1", "docs/a.md", "completed", refused)]).querySelector("[data-step=tool]")!;
    expect(line.textContent).toBe("Read docs/a.md (failed)");
    expect(line.className).toContain("text-destructive");
  });
});
