import type { Meta, StoryObj } from "@storybook/react-vite";
import { ItemsRenderer } from "@flow-state-dev/react";

import { SessionItemsProvider } from "./session-items-context";
import { ToolGroup } from "./tool";
import { plainConversation, toolUseConversation } from "../../stories/fixtures/sessions";

const meta = {
  title: "Components/ChatAssistant",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const Demo = ({
  items,
}: {
  items: Parameters<typeof ItemsRenderer>[0]["items"];
}) => (
  <div style={{ width: 720 }}>
    <SessionItemsProvider value={items}>
      <ItemsRenderer items={items} toolGroupRenderer={ToolGroup} />
    </SessionItemsProvider>
  </div>
);

export const PlainConversation: Story = {
  render: () => <Demo items={plainConversation()} />,
};

export const ToolUseConversation: Story = {
  render: () => <Demo items={toolUseConversation()} />,
};
