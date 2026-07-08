import type { Meta, StoryObj } from "@storybook/react-vite";

import { ModelBadge } from "./model-badge";

const meta = {
  title: "Components/ModelBadge",
  component: ModelBadge,
  parameters: { layout: "padded" },
  args: { model: { actual: "gpt-5.4-mini" } },
} satisfies Meta<typeof ModelBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Just the actual model id. */
export const Basic: Story = {
  args: { model: { actual: "gpt-5.4-mini" } },
};

/**
 * Full identity — the tooltip lists the requested string and gateway when they
 * differ from / accompany the actual model.
 */
export const WithRequestedAndGateway: Story = {
  args: {
    model: {
      actual: "gpt-5.5-2025-04-12",
      requested: "openai/gpt-5.5",
      gateway: "openrouter",
    },
  },
};

/** Renders nothing when the identity is absent. */
export const Undefined: Story = {
  args: { model: undefined },
};
