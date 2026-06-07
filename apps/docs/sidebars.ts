import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      items: [
        "getting-started/quick-start",
        "getting-started/setting-up-models",
        "getting-started/your-first-flow",
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
            "fundamentals/state-operations",
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
            "sequencers/composing-blocks",
            "sequencers/control-flow",
            "sequencers/wait-for-condition",
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
            "resources/manifest",
          ],
        },
        {
          type: "category",
          label: "Streaming and Items",
          items: [
            "streaming/overview",
            "streaming/emitting-items",
            "streaming/items",
            "streaming/trace-channel",
          ],
        },
        {
          type: "category",
          label: "Server",
          items: [
            "server/setup",
            "server/authentication",
            "server/mcp",
            "server/chat",
            {
              type: "category",
              label: "Scheduled actions",
              items: [
                "server/scheduled",
                "server/schedule-index",
              ],
            },
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
            "testing/end-to-end-tests",
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
              label: "Coordination Patterns",
              items: [
                "patterns/parallelTasks",
                "patterns/supervisor",
                "patterns/task-board",
                "patterns/plan-and-execute",
                "patterns/flow-policy",
                "patterns/routed-specialists",
                "patterns/round-robin",
                "patterns/debate",
                "patterns/event-actors",
              ],
            },
            {
              type: "category",
              label: "Other Patterns",
              items: [
                "patterns/response-auditor",
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
            "tools/claude-code-cli",
          ],
        },
        {
          type: "category",
          label: "Skills",
          items: [
            "skills/overview",
            "skills/activation",
            "skills/authoring",
            "skills/pattern-skills",
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
        {
          type: "category",
          label: "Memory",
          items: [
            "memory/overview",
            "memory/configuration",
            "memory/recall-tool",
            "memory/hygiene",
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
            "devtool/observing-resource-loads",
            "devtool/debug-vs-client-state",
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
        "advanced/generator-prompts-markdown",
        "advanced/resource-templates-markdown",
        "advanced/error-handling",
        "advanced/error-capture",
        "advanced/idempotency",
        "advanced/durable-execution",
        "advanced/voice",
        "advanced/sequencer-side-chains",
        "advanced/custom-model-resolver",
        "advanced/inbound-transports",
        "advanced/manual-flow-execution",
        "advanced/state-targets-and-parents",
        "advanced/sequencer-state",
        "state/mutation-model",
        "advanced/utility-blocks-deprecated",
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
        "api/cli",
      ],
    },
  ],
};

export default sidebars;
