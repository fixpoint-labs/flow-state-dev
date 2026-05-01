import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: "category",
      label: "Getting Started",
      items: [
        "intro",
        "getting-started/quick-start",
        "getting-started/installation",
        "getting-started/project-structure",
      ],
    },
    {
      type: "category",
      label: "Core",
      items: [
        {
          type: "category",
          label: "Fundamentals",
          items: [
            "fundamentals/overview",
            "fundamentals/blocks",
            "fundamentals/flows",
            "fundamentals/actions",
            "fundamentals/state-and-scopes",
            "fundamentals/capabilities",
            "fundamentals/type-system",
            "fundamentals/models",
          ],
        },
        {
          type: "category",
          label: "Composition",
          items: [
            "sequencers/overview",
            "sequencers/control-flow",
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
          label: "Streaming and Items",
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
            "server/authentication",
            "server/connection-resilience",
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
            "testing/flow-integration-tests",
          ],
        },
      ],
    },
    {
      type: "category",
      label: "Ecosystem",
      items: [
        "ecosystem/overview",
        {
          type: "category",
          label: "Patterns",
          items: [
            "patterns/overview",
            {
              type: "category",
              label: "Substrates",
              items: [
                "patterns/task-board",
                "patterns/event-actors",
              ],
            },
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
                "patterns/coordinator",
              ],
            },
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
            "tools/mcp",
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
        {
          type: "category",
          label: "UI",
          items: [
            "ui/overview",
            "ui/common-components",
            "ui/flow-aware-components",
            "ui/generative",
          ],
        },
        "ecosystem/thought-fabric-pointer",
        {
          type: "category",
          label: "Dev Experience",
          items: [
            "cli/overview",
            "cli/agent-dev-loop",
            "devtool/overview",
            "devtool/setup",
            "devtool/embedding",
          ],
        },
      ],
    },
    {
      type: "category",
      label: "Advanced",
      items: [
        "advanced/capabilities-authoring",
        "advanced/flow-isolation",
        "advanced/generator-context",
        "advanced/voice",
        "advanced/sequencer-side-chains",
        "advanced/state-targets-and-parents",
        "advanced/sequencer-state",
        "advanced/item-types",
        "advanced/agent-types",
        "advanced/transient-slots",
        "advanced/clientdata-redaction",
        "advanced/custom-model-resolver",
        "advanced/model-groups",
        "advanced/inbound-transports",
        "advanced/utility-blocks-deprecated",
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
    },
  ],
};

export default sidebars;
