import type { Meta, StoryObj } from "@storybook/react-vite";
import { FlowNavigator, type FlowNavigatorSlots } from "@flow-state-dev/react";
import { Copy, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import {
  failingFlowsSource,
  flowEntry,
  flowsSource,
  loadingFlowsSource,
  sessionEntry,
  sessionsSource,
} from "../fixtures/workforce";

/*
 * The tree the rail-layout fix was found on: three collection kinds, a
 * singleton with one session, and engine-minted session ids with
 * no title. The `long` copy and its session have labels too long for a narrow
 * rail.
 */
const flows = [
  flowEntry("support.iris", "agent", "collection"),
  flowEntry("support.otto", "agent", "collection"),
  flowEntry("support.ada", "desk-clerk", "collection"),
  flowEntry("support.grace", "desk-clerk", "collection"),
  flowEntry("digest", "digest", "singleton"),
  flowEntry("support.wren", "followup-runner", "collection"),
];
const long = flowEntry("support.escalations-overnight-weekend-queue", "desk-clerk", "collection");

const sessions = sessionsSource({
  "support.iris": [sessionEntry("sess_1790206121611_42636c63df102", "agent")],
  "support.otto": [],
  "support.ada": [
    sessionEntry("sess_1790206133090_9f1e07ab55c3", "desk-clerk"),
    sessionEntry("sess_1790206140712_0c4d2e91aa7f", "desk-clerk"),
  ],
  "support.grace": [sessionEntry("sess_1790206151208_7b2a90cc1e40", "desk-clerk")],
  digest: [sessionEntry("support.noticeboard", "digest")],
  "support.wren": [sessionEntry("sess_1790206170444_e3a19b62f08d", "followup-runner")],
  [long.id]: [
    sessionEntry(
      "sess_1790206180000_5d0c11aa9e21",
      "desk-clerk",
      "Refund escalation for order 4417 and both linked chargebacks"
    ),
  ],
});

const iconButton = (label: string, Icon: typeof Copy) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    style={{ display: "inline-flex", padding: 2, border: 0, background: "none", color: "inherit", cursor: "pointer" }}
  >
    <Icon size={12} />
  </button>
);

/** A host's own affordances, the way a developer tool fills them. */
const hostSlots: FlowNavigatorSlots = {
  rowTrailing: (row) =>
    row.type === "instance" ? iconButton(`Copy instance ID ${row.instance.id}`, Copy) : null,
  leafToolbar: () => (
    <>
      {iconButton("Refresh sessions", RefreshCw)}
      {iconButton("New session", Plus)}
    </>
  ),
};

const meta = {
  title: "React/FlowNavigator",
  component: FlowNavigator,
  parameters: { layout: "padded" },
  args: {
    sections: [{ label: "Flows" }],
    onSelectSession: () => {},
    userId: "story-user",
    sessionClient: sessions,
  },
  // Selection is the host's to keep, so the story keeps it.
  render: function Render(args, context) {
    const [selected, setSelected] = useState<string | undefined>(args.selectedSessionId);
    return (
      <div style={{ width: context.parameters.railWidth ?? 300 }}>
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
 * Kinds with their copies, and a singleton with one session, with a
 * host's copy, refresh and new-session buttons in the slots. Open rows to
 * list their sessions; `support.otto` has none yet.
 */
export const Populated: Story = {
  args: { client: flowsSource(flows), slots: hostSlots },
};

/** A 256px rail with a copy and a session whose labels do not fit: both end in an ellipsis. */
export const LongLabels: Story = {
  args: { client: flowsSource([...flows, long]), slots: hostSlots },
  parameters: { railWidth: 256 },
};
