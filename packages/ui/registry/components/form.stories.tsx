import type { Meta, StoryObj } from "@storybook/react-vite";
import { FlowProvider } from "@flow-state-dev/react";

import { Form } from "./form";
import { SessionItemsProvider } from "./session-items-context";
import { suspensionItem, suspensionResumeItem } from "../../stories/fixtures/items";

const SUSPENSION_ID = "susp-form";

// A flat object combining a free-text field, a single-choice enum, and a
// checkbox — the "one or all three in one resume" shape.
const item = suspensionItem({
  suspensionId: SUSPENSION_ID,
  reason: "human_input",
  message: "Share feedback before we continue",
  resumeSchema: {
    type: "object",
    properties: {
      comments: { type: "string", title: "Comments" },
      priority: { type: "string", enum: ["low", "medium", "high"], title: "Priority" },
      urgent: { type: "boolean", title: "Mark as urgent" },
    },
    required: ["priority"],
  },
  allow: ["submit", "skip"],
});

const meta = {
  title: "Components/Form",
  component: Form,
  parameters: { layout: "padded" },
  args: { item },
} satisfies Meta<typeof Form>;

export default meta;
type Story = StoryObj<typeof meta>;

const wrap = (resume: ReturnType<typeof suspensionResumeItem>[]) => (
  <div style={{ width: 520 }}>
    <FlowProvider flowKind="demo" userId="demo" baseUrl="">
      <SessionItemsProvider value={[item, ...resume]}>
        <Form item={item} />
      </SessionItemsProvider>
    </FlowProvider>
  </div>
);

export const Pending: Story = {
  render: () => wrap([]),
};

export const Submitted: Story = {
  render: () =>
    wrap([suspensionResumeItem({ suspensionId: SUSPENSION_ID, resolution: "submitted" })]),
};

export const Skipped: Story = {
  render: () =>
    wrap([suspensionResumeItem({ suspensionId: SUSPENSION_ID, resolution: "skipped" })]),
};
