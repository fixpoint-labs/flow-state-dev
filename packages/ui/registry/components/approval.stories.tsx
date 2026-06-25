import type { Meta, StoryObj } from "@storybook/react-vite";
import { FlowProvider } from "@flow-state-dev/react";

import { Approval } from "./approval";
import { SessionItemsProvider } from "./session-items-context";
import { suspensionItem, suspensionResumeItem } from "../../stories/fixtures/items";

const SUSPENSION_ID = "susp-1";

const item = suspensionItem({
  suspensionId: SUSPENSION_ID,
  message: "Send the drafted email to the customer?",
});

const meta = {
  title: "Components/Approval",
  component: Approval,
  parameters: { layout: "padded" },
  // Each story renders its own provider-wrapped tree; this satisfies the
  // required `item` prop at the meta level so stories can be render-only.
  args: { item },
} satisfies Meta<typeof Approval>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * `flowKind` enables the Approve/Reject buttons (the hook needs a resume target);
 * `SessionItemsProvider` carries any `suspension_resume` item that resolves the
 * card. Resolved stories supply that resume; the pending story leaves it empty.
 */
const wrap = (
  resume: ReturnType<typeof suspensionResumeItem>[],
) => (
  <div style={{ width: 520 }}>
    <FlowProvider flowKind="demo" userId="demo" baseUrl="">
      <SessionItemsProvider value={[item, ...resume]}>
        <Approval item={item} />
      </SessionItemsProvider>
    </FlowProvider>
  </div>
);

export const Pending: Story = {
  render: () => wrap([]),
};

export const WithDetails: Story = {
  render: () => (
    <div style={{ width: 520 }}>
      <FlowProvider flowKind="demo" userId="demo" baseUrl="">
        <SessionItemsProvider value={[]}>
          <Approval
            item={suspensionItem({
              suspensionId: "susp-details",
              message: "Charge the customer's card?",
              data: { amount: 4200, currency: "USD", customer: "acme-co" },
            })}
          />
        </SessionItemsProvider>
      </FlowProvider>
    </div>
  ),
};

export const Approved: Story = {
  render: () =>
    wrap([suspensionResumeItem({ suspensionId: SUSPENSION_ID, resolution: "approved" })]),
};

export const Rejected: Story = {
  render: () =>
    wrap([suspensionResumeItem({ suspensionId: SUSPENSION_ID, resolution: "rejected" })]),
};

export const TimedOut: Story = {
  render: () =>
    wrap([suspensionResumeItem({ suspensionId: SUSPENSION_ID, resolution: "timed_out" })]),
};
