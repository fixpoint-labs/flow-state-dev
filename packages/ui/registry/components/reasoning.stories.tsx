import type { Meta, StoryObj } from "@storybook/react-vite";

import { Reasoning } from "./reasoning";
import { reasoningItem } from "../../stories/fixtures/items";

const meta = {
  title: "Components/Reasoning",
  component: Reasoning,
} satisfies Meta<typeof Reasoning>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Completed: Story = {
  args: {
    item: reasoningItem({
      text: "The user is asking about deployment. I should clarify whether they mean Vercel or Railway before giving a specific answer, since the steps differ.",
    }),
  },
};

export const Streaming: Story = {
  args: {
    item: reasoningItem({
      text: "Looking at the request, I need to consider",
      status: "in_progress",
    }),
  },
};
