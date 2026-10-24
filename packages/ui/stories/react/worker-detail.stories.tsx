import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkerDetail } from "@flow-state-dev/react";

import {
  failingItemSource,
  itemSource,
  loadingItemSource,
} from "../fixtures/workforce";

/**
 * One worker's kind and instructions. The five stories are the five
 * instruction states, each marked with its own `data-state`.
 */
const meta = {
  title: "React/Worker detail",
  component: WorkerDetail,
  parameters: { layout: "padded" },
  args: { sessionId: "story-session", kind: "support-agent" },
} satisfies Meta<typeof WorkerDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The worker's roster row carries instructions. */
export const Instructions: Story = {
  args: {
    workerId: "support.ada",
    client: itemSource({
      workerId: "support.ada",
      flow: "support-agent",
      instructions: "Answer billing questions. Hand refunds over $500 to a person.",
    }),
  },
};

/** The worker was hired with no instructions. */
export const NoneGiven: Story = {
  args: {
    workerId: "support.grace",
    client: itemSource({ workerId: "support.grace", flow: "support-agent", instructions: null }),
  },
};

/** The worker has no public roster row, so nothing is read at all. */
export const NotPublished: Story = {
  args: {},
};

/** The instructions read has not answered yet. */
export const Loading: Story = {
  args: { workerId: "support.ada", client: loadingItemSource },
};

/** The read failed. The line says what failed and offers Retry. */
export const Failed: Story = {
  args: {
    workerId: "support.ada",
    client: failingItemSource("Failed to load this worker's instructions"),
  },
};
