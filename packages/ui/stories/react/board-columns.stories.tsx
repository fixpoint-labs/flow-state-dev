import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoardColumns } from "@flow-state-dev/react/workforce";

import {
  boardTask,
  failingRowsSource,
  loadingRowsSource,
  resourcesSource,
} from "../fixtures/workforce";

const meta = {
  title: "React/BoardColumns",
  component: BoardColumns,
  parameters: { layout: "padded" },
  args: { sessionId: "story-session", boardRef: "support.inbox" },
} satisfies Meta<typeof BoardColumns>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The board read has not answered yet. */
export const Loading: Story = {
  args: { client: loadingRowsSource },
};

/** A board with no rows, which says why rather than spinning. */
export const Empty: Story = {
  args: { client: resourcesSource([]) },
};

/** The read failed. The line says what failed and offers Retry. */
export const Failed: Story = {
  args: { client: failingRowsSource("Failed to load this board") },
};

/**
 * Rows grouped into one column per status, in the board's fixed order. A
 * status this version does not know gets a column of its own at the end.
 */
export const Populated: Story = {
  args: {
    client: resourcesSource([
      boardTask("t1", "pending", { title: "Refund order 1042", assignee: "support.ada" }),
      boardTask("t2", "in_progress", { title: "Reset a customer's password", assignee: "support.grace" }),
      boardTask("t3", "held", { goal: "Escalate the outage report" }),
      boardTask("t4", "completed", { title: "Close duplicate ticket" }),
      boardTask("t5", "errored", { title: "Sync the CRM", error: "CRM returned 503" }),
      boardTask("t6", "awaiting_review", { title: "Draft reply to a VIP" }),
      boardTask("t7", "snoozed", { title: "Follow up next week" }),
    ]),
  },
};
