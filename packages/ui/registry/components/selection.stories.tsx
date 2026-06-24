import type { Meta, StoryObj } from "@storybook/react-vite";
import { FlowProvider } from "@flow-state-dev/react";

import { Selection } from "./selection";
import { SessionItemsProvider } from "./session-items-context";
import { suspensionItem, suspensionResumeItem } from "../../stories/fixtures/items";

const SUSPENSION_ID = "susp-selection";

const item = suspensionItem({
  suspensionId: SUSPENSION_ID,
  reason: "human_input",
  message: "Which environment should we deploy to?",
  resumeSchema: { type: "string", enum: ["staging", "production", "canary"] },
  allow: ["submit"],
});

const meta = {
  title: "Components/Selection",
  component: Selection,
  parameters: { layout: "padded" },
  args: { item },
} satisfies Meta<typeof Selection>;

export default meta;
type Story = StoryObj<typeof meta>;

const wrap = (item: ReturnType<typeof suspensionItem>, resume: ReturnType<typeof suspensionResumeItem>[]) => (
  <div style={{ width: 520 }}>
    <FlowProvider flowKind="demo" userId="demo" baseUrl="">
      <SessionItemsProvider value={[item, ...resume]}>
        <Selection item={item} />
      </SessionItemsProvider>
    </FlowProvider>
  </div>
);

/** Single choice — a top-level enum renders radios. */
export const SingleChoice: Story = {
  render: () => wrap(item, []),
};

/** Multi choice — an array of an enum renders checkboxes. */
export const MultiChoice: Story = {
  render: () =>
    wrap(
      suspensionItem({
        suspensionId: "susp-selection-multi",
        reason: "human_input",
        message: "Which checks should block the merge?",
        resumeSchema: { type: "array", items: { type: "string", enum: ["lint", "test", "typecheck", "e2e"] } },
        allow: ["submit", "skip"],
      }),
      [],
    ),
};

export const Submitted: Story = {
  render: () =>
    wrap(item, [suspensionResumeItem({ suspensionId: SUSPENSION_ID, resolution: "submitted" })]),
};
