import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      items: [
        "getting-started/quick-start",
        "getting-started/installation",
        "getting-started/project-structure",
      ],
    },
    {
      type: "category",
      label: "Concepts",
      items: [
        "concepts/blocks",
        "concepts/flows",
        "concepts/actions",
        "concepts/state",
        "concepts/type-system",
        "concepts/streaming",
        "concepts/testing",
      ],
    },
    {
      type: "category",
      label: "Guides",
      items: [
        "guides/building-a-chat-app",
        "guides/server-setup",
        "guides/react-integration",
        "guides/testing-flows",
        "guides/custom-model-resolver",
        "guides/sequencer-patterns",
      ],
    },
    {
      type: "category",
      label: "API Reference",
      items: [
        "api/core",
        "api/server",
        "api/client",
        "api/react",
        "api/testing",
      ],
    },
  ],
};

export default sidebars;
