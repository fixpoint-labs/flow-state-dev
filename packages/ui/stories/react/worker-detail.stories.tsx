import type { Meta, StoryObj } from "@storybook/react-vite";
import { SeatDetail } from "@flow-state-dev/react";

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
  component: SeatDetail,
  parameters: { layout: "padded" },
  args: { sessionId: "story-session", kind: "support-agent" },
} satisfies Meta<typeof SeatDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The worker's roster row carries instructions. */
export const Instructions: Story = {
  args: {
    seatId: "support.ada",
    resourceClient: itemSource({
      seatId: "support.ada",
      flow: "support-agent",
      instructions: "Answer billing questions. Hand refunds over $500 to a person.",
    }),
  },
};

/** The worker was hired with no instructions. */
export const NoneGiven: Story = {
  args: {
    seatId: "support.grace",
    resourceClient: itemSource({ seatId: "support.grace", flow: "support-agent", instructions: null }),
  },
};

/** The worker has no public roster row, so nothing is read at all. */
export const NotPublished: Story = {
  args: {},
};

/** The instructions read has not answered yet. */
export const Loading: Story = {
  args: { seatId: "support.ada", resourceClient: loadingItemSource },
};

/** The read failed. The line says what failed and offers Retry. */
export const Failed: Story = {
  args: {
    seatId: "support.ada",
    resourceClient: failingItemSource("Failed to load this worker's instructions"),
  },
};
