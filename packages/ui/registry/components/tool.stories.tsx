import type { Meta, StoryObj } from "@storybook/react-vite";

import { Tool, ToolGroup } from "./tool";
import { toolItem } from "../../stories/fixtures/items";

const meta = {
  title: "Components/Tool",
  component: Tool,
} satisfies Meta<typeof Tool>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Completed: Story = {
  args: {
    item: toolItem({
      name: "web_search",
      args: { query: "flow state framework" },
      output: { results: 42, topResult: "https://flow-state.dev" },
    }),
  },
};

export const InProgress: Story = {
  args: {
    item: toolItem({
      name: "write_file",
      args: { path: "src/index.ts" },
      status: "in_progress",
    }),
  },
};

export const Errored: Story = {
  args: {
    item: toolItem({
      name: "fetch_url",
      args: { url: "https://example.com/missing" },
      output: { error: "404 Not Found" },
      status: "errored",
    }),
  },
};

export const Group: StoryObj<typeof ToolGroup> = {
  render: (args) => <ToolGroup {...args} />,
  args: {
    items: [
      toolItem({ name: "web_search", args: { q: "react hooks" } }),
      toolItem({ name: "web_search", args: { q: "react context" } }),
      toolItem({ name: "write_file", args: { path: "notes.md" } }),
    ],
  },
};
