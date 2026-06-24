import type { Meta, StoryObj } from "@storybook/react-vite";
import { FlowProvider } from "@flow-state-dev/react";

import { Question } from "./question";
import { SessionItemsProvider } from "./session-items-context";
import { suspensionItem, suspensionResumeItem } from "../../stories/fixtures/items";

const SUSPENSION_ID = "susp-question";

const item = suspensionItem({
  suspensionId: SUSPENSION_ID,
  reason: "human_input",
  message: "What should we know about the launch deadline?",
  resumeSchema: { type: "string", minLength: 1 },
  allow: ["submit"],
});

const meta = {
  title: "Components/Question",
  component: Question,
  parameters: { layout: "padded" },
  args: { item },
} satisfies Meta<typeof Question>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * `flowKind` gives the hook a resume target so Submit is enabled;
 * `SessionItemsProvider` carries the `suspension_resume` item that resolves the
 * card (none for the pending story).
 */
const wrap = (resume: ReturnType<typeof suspensionResumeItem>[]) => (
  <div style={{ width: 520 }}>
    <FlowProvider flowKind="demo" userId="demo" baseUrl="">
      <SessionItemsProvider value={[item, ...resume]}>
        <Question item={item} />
      </SessionItemsProvider>
    </FlowProvider>
  </div>
);

export const Pending: Story = {
  render: () => wrap([]),
};

export const Skippable: Story = {
  render: () => (
    <div style={{ width: 520 }}>
      <FlowProvider flowKind="demo" userId="demo" baseUrl="">
        <SessionItemsProvider value={[]}>
          <Question
            item={suspensionItem({
              suspensionId: "susp-question-skip",
              reason: "human_input",
              message: "Any extra context? (optional)",
              resumeSchema: { type: "string" },
              allow: ["submit", "skip"],
            })}
          />
        </SessionItemsProvider>
      </FlowProvider>
    </div>
  ),
};

export const Submitted: Story = {
  render: () =>
    wrap([suspensionResumeItem({ suspensionId: SUSPENSION_ID, resolution: "submitted" })]),
};

export const Skipped: Story = {
  render: () =>
    wrap([suspensionResumeItem({ suspensionId: SUSPENSION_ID, resolution: "skipped" })]),
};
