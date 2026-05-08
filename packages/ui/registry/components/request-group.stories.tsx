import type { Meta, StoryObj } from "@storybook/react-vite";

import { RequestGroupRenderer } from "./request-group";
import { SessionItemsProvider } from "./session-items-context";
import {
  plainConversation,
  toolUseConversation,
} from "../../stories/fixtures/sessions";

const meta = {
  title: "Components/RequestGroupRenderer",
  component: RequestGroupRenderer,
  parameters: { layout: "padded" },
} satisfies Meta<typeof RequestGroupRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

const wrap = (items: Parameters<typeof RequestGroupRenderer>[0]["items"]) => (
  <div style={{ width: 720 }}>
    <SessionItemsProvider value={items}>
      <RequestGroupRenderer items={items} isStreaming={false} />
    </SessionItemsProvider>
  </div>
);

export const PlainExchange: Story = {
  render: () => wrap(plainConversation()),
};

export const WithToolCall: Story = {
  render: () => wrap(toolUseConversation()),
};

export const Streaming: Story = {
  render: () => {
    const items = toolUseConversation();
    return (
      <div style={{ width: 720 }}>
        <SessionItemsProvider value={items}>
          <RequestGroupRenderer
            items={items}
            isStreaming
            statusMessage="Calling get_weather…"
          />
        </SessionItemsProvider>
      </div>
    );
  },
};
