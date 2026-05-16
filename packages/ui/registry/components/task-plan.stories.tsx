import type { Meta, StoryObj } from "@storybook/react-vite";

import { SessionItemsProvider } from "./session-items-context";
import { TaskPlan } from "./task-plan";
import {
  makeBoardMeta,
  makeTask,
  makeTaskChange,
} from "../../stories/fixtures/tasks";

const meta = {
  title: "Components/TaskPlan",
  component: TaskPlan,
  parameters: { layout: "padded" },
} satisfies Meta<typeof TaskPlan>;

export default meta;
type Story = StoryObj<typeof meta>;

const COLLECTION = "demo-board";

const buildItems = (
  tasks: Parameters<typeof makeTask>[0][],
  boardStatus: "active" | "completed" = "active",
) => [
  makeBoardMeta({ collectionId: COLLECTION, meta: { status: boardStatus } }),
  ...tasks.map((t) =>
    makeTaskChange({ collectionId: COLLECTION, task: makeTask(t) }),
  ),
];

const wrap = (items: ReturnType<typeof buildItems>) => (
  <div style={{ width: 720 }}>
    <SessionItemsProvider value={items}>
      <TaskPlan collectionId={COLLECTION} />
    </SessionItemsProvider>
  </div>
);

export const Mixed: Story = {
  render: () =>
    wrap(
      buildItems([
        { id: "t1", goal: "Audit existing routes", status: "completed" },
        { id: "t2", goal: "Draft new routing layer", status: "in_progress" },
        { id: "t3", goal: "Migrate auth middleware", status: "pending" },
        { id: "t4", goal: "Update integration tests", status: "blocked" },
      ]),
    ),
};

export const AllCompleted: Story = {
  render: () =>
    wrap(
      buildItems(
        [
          { id: "t1", goal: "Spec the change", status: "completed" },
          { id: "t2", goal: "Implement", status: "completed" },
          { id: "t3", goal: "Ship", status: "completed" },
        ],
        "completed",
      ),
    ),
};

export const Empty: Story = {
  render: () => wrap([makeBoardMeta({ collectionId: COLLECTION })]),
};
