import type { Meta, StoryObj } from "@storybook/react-vite";
import { FlowProvider } from "@flow-state-dev/react";

import { Form } from "./form";
import { SessionItemsProvider } from "./session-items-context";
import { suspensionItem, suspensionResumeItem } from "../../stories/fixtures/items";

const SUSPENSION_ID = "susp-form";

// A flat object combining a free-text field, a single-choice enum, and a
// checkbox — the "one or all three in one resume" shape. Each property carries a
// `description` (from zod `.describe()`) so the rendered field shows context
// under its label, not just a bare name.
const item = suspensionItem({
  suspensionId: SUSPENSION_ID,
  reason: "human_input",
  message: "Before we route this ticket, a couple of quick questions.",
  resumeSchema: {
    type: "object",
    properties: {
      comments: {
        type: "string",
        title: "What went wrong?",
        description: "A sentence or two on what you observed. This goes to the on-call engineer verbatim.",
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high"],
        title: "How urgent is it?",
        description: "High pages someone now; medium is next business day; low is best-effort.",
      },
      urgent: {
        type: "boolean",
        title: "Customer-facing outage?",
        description: "Check this only if end users are currently affected — it escalates past the queue.",
      },
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
