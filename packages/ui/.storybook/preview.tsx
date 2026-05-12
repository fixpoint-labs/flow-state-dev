/**
 * Global Storybook preview setup.
 *
 * Wraps every story in a `<FlowProvider>` carrying the chat-assistant
 * renderer registry. Components that don't read the context are unaffected;
 * RequestGroup and ChatAssistant rely on it to resolve renderers.
 *
 * Also exposes a Theme toolbar (light/dark) backed by a `globalType` that
 * toggles the `.dark` class on `<html>` — the same hook Tailwind's
 * `@custom-variant dark` rule in preview.css reads, so every component
 * picks up the change without per-story plumbing.
 */
import type { Preview } from "@storybook/react-vite";
import { FlowProvider } from "@flow-state-dev/react";
import React, { useEffect } from "react";

import { chatAssistantRenderers } from "../registry/components/chat-assistant";
import "./preview.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: { expanded: true },
  },
  globalTypes: {
    theme: {
      description: "Color theme",
      defaultValue: "light",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === "dark" ? "dark" : "light";
      // Toggle on <html> so portal-mounted UI (popovers, tooltips)
      // inherits the variant alongside the story body.
      useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("dark", theme === "dark");
        return () => {
          root.classList.remove("dark");
        };
      }, [theme]);
      return (
        <FlowProvider renderers={chatAssistantRenderers}>
          <div className="bg-background text-foreground p-4">
            <Story />
          </div>
        </FlowProvider>
      );
    },
  ],
};

export default preview;
