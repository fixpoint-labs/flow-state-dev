import type { Meta, StoryObj } from "@storybook/react-vite";

import { SourcesGroup } from "./sources";
import { messageItem, sourceItem } from "../../stories/fixtures/items";

const meta = {
  title: "Components/Sources",
  component: SourcesGroup,
} satisfies Meta<typeof SourcesGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { items: [messageItem({ text: "No sources here." })] },
};

export const ThreeSources: Story = {
  args: {
    items: [
      sourceItem({
        url: "https://flow-state.dev/docs/streaming/emitting-items",
        title: "Emitting items",
      }),
      sourceItem({
        url: "https://flow-state.dev/docs/ui/overview",
        title: "UI overview",
      }),
      sourceItem({
        url: "https://flow-state.dev/blog/2026-03-06-philosophy",
        title: "Philosophy",
      }),
    ],
  },
};
