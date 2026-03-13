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
      label: "Fundamentals",
      items: [
        "fundamentals/overview",
        "fundamentals/blocks",
        "fundamentals/flows",
        "fundamentals/actions",
        "fundamentals/state-and-scopes",
        "fundamentals/type-system",
        "fundamentals/utility-blocks",
        "fundamentals/voice",
      ],
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
      label: "Items",
      items: [
        "streaming/overview",
        "streaming/items",
      ],
    },
    {
      type: "category",
      label: "Server",
      items: [
        "server/setup",
        "server/custom-model-resolver",
      ],
    },
    {
      type: "category",
      label: "Client",
      items: [
        "client/overview",
        "client/react",
      ],
    },
    {
      type: "category",
      label: "Testing",
      items: [
        "testing/overview",
        "testing/testing-flows",
      ],
    },
    {
      type: "category",
      label: "Thought Fabric",
      items: [
        "thought-fabric/introduction",
        "thought-fabric/attention",
        "thought-fabric/memory",
        "thought-fabric/identity",
      ],
    },
    {
      type: "category",
      label: "Guides",
      items: [
        "guides/building-a-chat-app",
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
