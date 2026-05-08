/**
 * Global Storybook preview setup.
 *
 * Wraps every story in a `<FlowProvider>` carrying the chat-assistant
 * renderer registry. Components that don't read the context are unaffected;
 * RequestGroup and ChatAssistant rely on it to resolve renderers.
 */
import type { Preview } from "@storybook/react-vite";
import { FlowProvider } from "@flow-state-dev/react";
import React from "react";

import { chatAssistantRenderers } from "../registry/components/chat-assistant";
import "./preview.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: { expanded: true },
  },
  decorators: [
    (Story) => (
      <FlowProvider renderers={chatAssistantRenderers}>
        <Story />
      </FlowProvider>
    ),
  ],
};

export default preview;
