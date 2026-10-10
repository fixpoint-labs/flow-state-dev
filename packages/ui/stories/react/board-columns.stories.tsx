import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoardColumns } from "@flow-state-dev/react";

import {
  boardRow,
  failingRowsSource,
  loadingRowsSource,
  rowsSource,
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
  args: { resourceClient: loadingRowsSource },
};

/** A board with no rows, which says why rather than spinning. */
export const Empty: Story = {
  args: { resourceClient: rowsSource([]) },
};

/** The read failed. The line says what failed and offers Retry. */
export const Failed: Story = {
  args: { resourceClient: failingRowsSource("Failed to load this board") },
};

/**
 * Rows grouped into one column per status, in the board's fixed order. A
 * status this version does not know gets a column of its own at the end.
 */
export const Populated: Story = {
  args: {
    resourceClient: rowsSource([
      boardRow("t1", "pending", { title: "Refund order 1042", assignee: "support.ada" }),
      boardRow("t2", "in_progress", { title: "Reset a customer's password", assignee: "support.grace" }),
      boardRow("t3", "blocked", { goal: "Escalate the outage report" }),
      boardRow("t4", "completed", { title: "Close duplicate ticket" }),
      boardRow("t5", "errored", { title: "Sync the CRM", error: "CRM returned 503" }),
      boardRow("t6", "awaiting_review", { title: "Draft reply to a VIP" }),
      boardRow("t7", "snoozed", { title: "Follow up next week" }),
    ]),
  },
};
