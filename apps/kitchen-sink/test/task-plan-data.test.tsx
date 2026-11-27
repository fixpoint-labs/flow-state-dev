// @vitest-environment happy-dom
/**
 * A task plan is one kind of item, `data`, serving two readers: code reads the
 * plan from the items, and the chat draws it through the renderer registered
 * for `task-board-meta`. What this pins, and why:
 *  - a task added to a board goes out once, as one `task-change` data item, so
 *    there is no second copy for a reader to pick or a renderer to skip;
 *  - code that has no UI gets the task back from those items;
 *  - the plan is drawn only because a renderer is registered for its
 *    dataType: with none, the same items draw nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { DataItem, OutputItem } from "@flow-state-dev/core/items";
import { runAction } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { FlowProvider, ItemsRenderer, type RendererRegistry } from "@flow-state-dev/react";
import { chatAssistantRenderers } from "../components/flow-state/chat-assistant";
import { SessionItemsProvider } from "../components/flow-state/session-items-context";
import {
  extractTaskPlanState,
  TASK_BOARD_META_DATA_TYPE,
  TASK_CHANGE_DATA_TYPE,
} from "../components/flow-state/task-plan-state";

afterEach(cleanup);

const COLLECTION = "plan";

/** One real run: a board adds a task, and announces itself as active. */
async function planItems(): Promise<OutputItem[]> {
  const flow = defineFlow({
    kind: "task-plan-data",
    actions: {
      run: handler({
        name: "planner",
        inputSchema: z.object({}),
        outputSchema: z.null(),
        execute: async (_input, ctx) => {
          ctx.emit.data(TASK_BOARD_META_DATA_TYPE, { collectionId: COLLECTION, status: "active" }, { key: COLLECTION });
          const board = await getOrCreateTaskCollection({ ctx, backing: "state", collectionId: COLLECTION });
          await board.createTask({ goal: "Draft the release notes", title: "Release notes" });
          return null;
        },
      }),
    },
  })();
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: "u",
    sessionId: "s",
    stores: createInMemoryStores(),
    runtimeConfig: {},
  });
  expect(result.error).toBeUndefined();
  return result.items as unknown as OutputItem[];
}

function draw(items: OutputItem[], renderers: RendererRegistry) {
  return render(
    <FlowProvider renderers={renderers}>
      <SessionItemsProvider value={items}>
        <ItemsRenderer items={items} />
      </SessionItemsProvider>
    </FlowProvider>
  );
}

describe("a task plan as data items", () => {
  it("emits the task once, as a data item code can read the plan from", async () => {
    const items = await planItems();
    const changes = items.filter(
      (item): item is DataItem => item.type === "data" && item.dataType === TASK_CHANGE_DATA_TYPE
    );
    expect(changes).toHaveLength(1);

    const plan = extractTaskPlanState(items, COLLECTION);
    expect(plan.tasks.map((entry) => entry.task.title)).toEqual(["Release notes"]);
    expect(plan.boardMeta.status).toBe("active");
  });

  it("is drawn by the renderer registered for its dataType, and by nothing without one", async () => {
    const items = await planItems();

    draw(items, chatAssistantRenderers);
    expect(screen.getByText("Release notes")).toBeDefined();
    cleanup();

    draw(items, { ...chatAssistantRenderers, data: {} });
    expect(screen.queryByText("Release notes")).toBeNull();
  });
});
