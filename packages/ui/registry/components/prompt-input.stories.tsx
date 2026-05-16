import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "./prompt-input";

const meta = {
  title: "Components/PromptInput",
  component: PromptInput,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PromptInput>;

export default meta;
type Story = StoryObj<typeof meta>;

const FrameStyle = { width: 640 };

export const Ready: Story = {
  render: () => (
    <div style={FrameStyle}>
      <PromptInput onSubmit={() => undefined}>
        <PromptInputBody>
          <PromptInputTextarea placeholder="Ask a question…" />
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit status="ready" />
          </PromptInputFooter>
        </PromptInputBody>
      </PromptInput>
    </div>
  ),
};

export const Submitting: Story = {
  render: () => (
    <div style={FrameStyle}>
      <PromptInput onSubmit={() => undefined}>
        <PromptInputBody>
          <PromptInputTextarea defaultValue="What is the weather in Tokyo?" />
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit status="submitting" />
          </PromptInputFooter>
        </PromptInputBody>
      </PromptInput>
    </div>
  ),
};

export const Streaming: Story = {
  render: () => (
    <div style={FrameStyle}>
      <PromptInput onSubmit={() => undefined}>
        <PromptInputBody>
          <PromptInputTextarea defaultValue="Tell me about Flow State." />
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit status="streaming" />
          </PromptInputFooter>
        </PromptInputBody>
      </PromptInput>
    </div>
  ),
};
