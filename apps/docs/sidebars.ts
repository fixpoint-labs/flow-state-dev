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
        "fundamentals/flow-isolation",
        "fundamentals/capabilities",
        "fundamentals/type-system",
        "fundamentals/utility-blocks",
        "fundamentals/models",
        "fundamentals/voice",
      ],
    },
    {
      type: "category",
      label: "Guides",
      items: [
        "guides/projects-on-org-scope",
      ],
    },
    {
      type: "category",
      label: "Block Sequencing",
      items: [
        "sequencers/overview",
        "sequencers/control-flow",
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
        "resources/collections",
        "resources/client-access",
      ],
    },
    {
      type: "category",
      label: "Patterns",
      items: [
        "patterns/overview",
        {
          type: "category",
          label: "Utility Blocks",
          items: [
            "patterns/utility-blocks/core",
            "patterns/utility-blocks/extensions",
          ],
        },
        {
          type: "category",
          label: "Composable Patterns",
          items: [
            "patterns/parallelTasks",
            "patterns/supervisor",
            "patterns/plan-and-execute",
            "patterns/response-auditor",
            "patterns/routed-specialists",
            "patterns/event-actors",
            "patterns/coordinator",
          ],
        },
      ],
    },
    {
      type: "category",
      label: "Items",
      items: [
        "streaming/overview",
        "streaming/emitting-items",
        "streaming/items",
      ],
    },
    {
      type: "category",
      label: "Server",
      items: [
        "server/setup",
        "server/custom-model-resolver",
        "server/model-groups",
        "server/inbound-transports",
        "server/authentication",
        "persistence/overview",
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
      label: "Dev Experience",
      items: [
        "cli/overview",
        "devtool/overview",
        "devtool/setup",
      ],
    },
    {
      type: "category",
      label: "Tools",
      items: [
        "tools/overview",
        "tools/fetch",
        "tools/crawl",
        "tools/bash",
      ],
    },
    {
      type: "category",
      label: "Skills",
      items: [
        "skills/overview",
        "skills/activation",
        "skills/authoring",
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
      ],
    },
  ],
};

export default sidebars;
