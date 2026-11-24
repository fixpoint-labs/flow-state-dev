// @vitest-environment happy-dom
/**
 * Guard: no record the substrate emits about itself reaches the chat thread
 * as raw JSON.
 *
 * `ItemRenderer` falls back to a `<pre>` of an item's own JSON when the
 * registry names no renderer for it. That fallback is a development aid. For
 * an item the substrate emits about itself it is a defect: the user sees a
 * JSON blob in the thread about bookkeeping they have no part in.
 *
 * The substrate's records are `data` items, and a `data` item the registry
 * does not name renders nothing. So the shipped chat registry names only the
 * record that has a card to be (`task-board-meta` mounts the board) and leaves
 * the rest unnamed. This renders each unnamed record through the shipped
 * registry and checks nothing comes out.
 */
import type { DataItem } from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";
import { FlowProvider, ItemRenderer } from "@flow-state-dev/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { chatAssistantRenderers } from "../../registry/components/chat-assistant";

afterEach(cleanup);

/**
 * Data types the substrate emits about itself, with no card of their own. A
 * superset of the exclusion set in `@flow-state-dev/contracts`'
 * `items/task-attribution.ts` minus `task-board-meta` — the two lists answer
 * different questions (whose output is this, versus should a user see it) but
 * they are drawn from the same population, so a type added there belongs here
 * too.
 */
const UNCARDED_SUBSTRATE_RECORDS = [
  // Read by `<TaskPlan />` off the session items; never a card of its own.
  "task-change",
  // The board could not record a result it had saved. The caller-visible
  // signal is the run's own failure; the entry exists so that failure
  // survives the run.
  "task-board-recorder-failure",
  // `goalSeekLoop`'s stop reason and drain count, emitted once when the loop
  // exits. It is for tests and tooling reading the stream, not for a reader.
  "goal-seek-loop-termination",
];

/** Stamped `{ client: false, history: false }`: neither ever reaches a client stream. */
const CLIENT_INVISIBLE_RECORDS = ["task-board-recorder-failure", "goal-seek-loop-termination"];

function record(dataType: string, withVisibility: boolean): DataItem {
  return {
    id: `item_data_${dataType}`,
    type: "data",
    status: "completed",
    requestId: "req-1",
    itemIndex: 0,
    ts: 0,
    provenance: { blockName: "test", blockInstanceId: "test", phase: "main" },
    dataType,
    value: { collectionId: "board-1", reason: "done" },
    itemVisibility: withVisibility ? { client: true, history: false } : { client: false, history: false },
  } as DataItem;
}

describe("the shipped chat registry renders no substrate record as raw JSON", () => {
  it.each(UNCARDED_SUBSTRATE_RECORDS)("%s renders nothing, even when a client receives it", (dataType) => {
    const { container } = render(
      <FlowProvider renderers={chatAssistantRenderers}>
        <ItemRenderer item={record(dataType, true)} />
      </FlowProvider>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("mounts the board from task-board-meta through the data slot", () => {
    expect(typeof chatAssistantRenderers.data?.["task-board-meta"]).toBe("function");
  });

  it.each(CLIENT_INVISIBLE_RECORDS)("%s, stamped off the client, reaches no client", (dataType) => {
    expect(resolveItemVisibility(record(dataType, false))).toEqual({ client: false, history: false });
  });
});
