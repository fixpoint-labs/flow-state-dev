import type { Meta, StoryObj } from "@storybook/react-vite";
import { Roster } from "@flow-state-dev/workforce/react";

import {
  failingResourcesSource,
  loadingResourcesSource,
  rosterWorker,
  resourcesSource,
} from "../fixtures/workforce";

const meta = {
  title: "React/Roster",
  component: Roster,
  parameters: { layout: "padded" },
  args: { sessionId: "story-session" },
} satisfies Meta<typeof Roster>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The roster read has not answered yet. */
export const Loading: Story = {
  args: { client: loadingResourcesSource },
};

/** The organization has hired nobody. */
export const Empty: Story = {
  args: { client: resourcesSource([]) },
};

/** The read failed. The line says what failed and offers Retry; nothing re-reads on a timer. */
export const Failed: Story = {
  args: { client: failingResourcesSource("Failed to load the roster") },
};

/** Workers on the roster, each with the flow it runs. */
export const Populated: Story = {
  args: {
    client: resourcesSource([
      rosterWorker("support.ada", "support-agent", "Answer billing questions."),
      rosterWorker("support.grace", "support-agent"),
      rosterWorker("triage.lin", "triage-agent", "Route new tickets."),
    ]),
  },
};

/**
 * Rows a boot reload could not restore (passed in as `problems`) and a stored
 * row this version cannot read are both counted, beside the workers that did load.
 */
export const WithProblems: Story = {
  args: {
    problems: ['support.kay: flow "billing-agent" is not registered'],
    client: resourcesSource([
      rosterWorker("support.ada", "support-agent"),
      { topic: "broken", clientData: { workerId: "broken" } },
    ]),
  },
};
