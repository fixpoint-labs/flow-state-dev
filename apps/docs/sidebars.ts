import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    "fundamentals/overview",
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
        "concepts/scopes",
        "concepts/type-system",
        "concepts/streaming",
        "concepts/testing",
      ],
    },
    {
      type: "category",
      label: "Streaming",
      items: ["streaming/overview", "streaming/items"],
    },
    {
      type: "category",
      label: "Client",
      items: ["client/overview", "client/react"],
    },
    {
      type: "category",
      label: "Sequencers",
      items: [
        "sequencers/overview",
        "sequencers/patterns",
        "sequencers/side-chains",
        "sequencers/connectors",
      ],
    },
    {
      type: "category",
      label: "Resources",
      items: [
        "resources/overview",
        "resources/storage",
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
        "guides/state-storage",
        "guides/utility-blocks",
        "guides/working-memory",
        "guides/voice",
      ],
    },
    "roadmap",
    {
      type: "category",
      label: "API Reference",
      items: [
        "api/core",
        "api/server",
        "api/client",
        "api/react",
        "api/testing",
        "api/cli",
        "api/thought-fabric-core",
      ],
    },
  ],
};

export default sidebars;
