import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./conversation";

const meta = {
  title: "Components/Conversation",
  component: Conversation,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Conversation>;

export default meta;
type Story = StoryObj<typeof meta>;

const FrameStyle = { height: 480, width: 640, border: "1px solid var(--color-border)" };

export const Empty: Story = {
  render: () => (
    <div style={FrameStyle}>
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState />
        </ConversationContent>
      </Conversation>
    </div>
  ),
};

export const WithMessages: Story = {
  render: () => (
    <div style={FrameStyle}>
      <Conversation>
        <ConversationContent>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card p-3 text-sm"
            >
              Message {i + 1} — lorem ipsum dolor sit amet, consectetur adipiscing elit.
            </div>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  ),
};
