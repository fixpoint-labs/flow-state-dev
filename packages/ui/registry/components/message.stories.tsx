import type { Meta, StoryObj } from "@storybook/react-vite";

import { Message } from "./message";
import { messageItem } from "../../stories/fixtures/items";

const meta = {
  title: "Components/Message",
  component: Message,
} satisfies Meta<typeof Message>;

export default meta;
type Story = StoryObj<typeof meta>;

export const User: Story = {
  args: {
    item: messageItem({
      role: "user",
      text: "What's the difference between a sequencer and a router?",
    }),
  },
};

export const Assistant: Story = {
  args: {
    item: messageItem({
      role: "assistant",
      text: "A sequencer runs blocks one after another. A router picks one of several blocks based on the input. Sequencers compose; routers branch.",
    }),
  },
};

export const Streaming: Story = {
  args: {
    item: messageItem({
      role: "assistant",
      text: "Let me think about that. The key distinction here is",
      status: "in_progress",
    }),
  },
};
