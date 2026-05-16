import type { Meta, StoryObj } from "@storybook/react-vite";

import { Suggestion, Suggestions } from "./suggestion";

const meta = {
  title: "Components/Suggestion",
  component: Suggestion,
} satisfies Meta<typeof Suggestion>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLES = [
  "Build me a todo app",
  "Explain hooks like I'm five",
  "What's new in React 19?",
  "Compare REST and GraphQL",
  "Set up a Vercel deploy",
];

export const Default: Story = {
  render: () => (
    <div style={{ width: 640 }}>
      <Suggestions>
        {SAMPLES.map((s) => (
          <Suggestion key={s} suggestion={s} />
        ))}
      </Suggestions>
    </div>
  ),
};

export const SingleSuggestion: Story = {
  render: () => (
    <div style={{ width: 640 }}>
      <Suggestions>
        <Suggestion suggestion="Try this one" />
      </Suggestions>
    </div>
  ),
};
