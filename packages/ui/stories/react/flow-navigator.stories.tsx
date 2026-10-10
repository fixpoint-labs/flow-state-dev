import type { Meta, StoryObj } from "@storybook/react-vite";
import { FlowNavigator } from "@flow-state-dev/react";
import { useState } from "react";

import {
  failingFlowsSource,
  flowEntry,
  flowsSource,
  loadingFlowsSource,
  sessionEntry,
  sessionsSource,
} from "../fixtures/workforce";

const sessions = sessionsSource({
  chat: [sessionEntry("sess_chat_1", "chat", "Onboarding questions")],
  "support.ada": [
    sessionEntry("sess_ada_1", "support-agent", "Refund order 1042"),
    sessionEntry("sess_1767225600000_3df102", "support-agent"),
  ],
  "support.grace": [],
});

const meta = {
  title: "React/FlowNavigator",
  component: FlowNavigator,
  parameters: { layout: "padded" },
  args: {
    sections: [
      { label: "Chats", kinds: ["chat"] },
      { label: "Workers", kinds: ["support-agent"] },
    ],
    onSelectSession: () => {},
    userId: "story-user",
    sessionClient: sessions,
  },
  // Selection is the host's to keep, so the story keeps it.
  render: function Render(args) {
    const [selected, setSelected] = useState<string | undefined>(args.selectedSessionId);
    return (
      <div style={{ width: 280 }}>
        <FlowNavigator
          {...args}
          selectedSessionId={selected}
          onSelectSession={(sessionId, leaf) => {
            setSelected(sessionId);
            args.onSelectSession(sessionId, leaf);
          }}
        />
      </div>
    );
  },
} satisfies Meta<typeof FlowNavigator>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The flow list has not answered yet. */
export const Loading: Story = {
  args: { client: loadingFlowsSource },
};

/** The server registers none of the kinds a section names. */
export const Empty: Story = {
  args: { client: flowsSource([]) },
};

/** The flow list read failed. The line says what failed and offers Retry. */
export const Failed: Story = {
  args: { client: failingFlowsSource("Failed to load flows") },
};

/**
 * A singleton kind and a collection kind with two copies. Open a row to list
 * its sessions; one copy has none yet.
 */
export const Populated: Story = {
  args: {
    client: flowsSource([
      flowEntry("chat", "chat", "singleton"),
      flowEntry("support.ada", "support-agent", "collection"),
      flowEntry("support.grace", "support-agent", "collection"),
    ]),
  },
};
