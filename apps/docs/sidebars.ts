import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      items: [
        "getting-started/installation",
        "getting-started/setting-up-models",
        "getting-started/quick-start",
        "getting-started/your-first-flow",
        "getting-started/project-structure",
      ],
    },
    {
      type: "category",
      label: "Configuration",
      items: [
        "configuration/overview",
        "configuration/flow",
        "configuration/blocks",
        "configuration/runtime",
        "configuration/environment",
        "configuration/client",
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
            "resources/external-collections",
            "resources/reactive-blocks",
            "resources/edges",
            "resources/client-access",
            "resources/searching",
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
            "server/background-work",
            "server/authentication",
            "server/mcp",
            "server/chat",
            "server/webhooks",
            {
              type: "category",
              label: "Scheduled actions",
              items: [
                "server/scheduled",
                "server/schedule-index",
              ],
            },
            "server/connection-resilience",
            "server/host-adapters",
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
            "testing/benchmarks",
          ],
        },
      ],
    },
    {
      type: "category",
      label: "Orchestration",
      items: [
        "orchestration/overview",
        "orchestration/task-substrate",
        "orchestration/task-board",
        "orchestration/goal-seek-loop",
        "orchestration/flow-policy",
        "orchestration/context-supply",
        "orchestration/agents",
        {
          type: "category",
          label: "Skills",
          items: [
            "skills/overview",
            "skills/binding",
            "skills/activation",
            "skills/authoring",
            "skills/delegation",
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
                "patterns/plan-and-execute",
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
            "tools/search",
            "tools/fetch",
            "tools/crawl",
            "tools/bash",
            "tools/mcp",
            "tools/claude-code-cli",
            "tools/claude-code-sdk",
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
            "memory/relations",
            "memory/recall-tool",
            "memory/hygiene",
          ],
        },
        {
          type: "category",
          label: "Dev Experience",
          items: [
            "cli/overview",
            "cli/configuration",
            "cli/agent-dev-loop",
            "cli/interactive-chat",
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
        {
          type: "category",
          label: "Authoring",
          items: [
            "advanced/capabilities-authoring",
            "advanced/generator-context",
            "advanced/generator-prompts-markdown",
            "advanced/resource-templates-markdown",
            "advanced/sequencer-side-chains",
          ],
        },
        {
          type: "category",
          label: "Reliability",
          items: [
            "advanced/error-handling",
            "advanced/error-capture",
            "advanced/concurrency-policies",
            "advanced/idempotency",
          ],
        },
        {
          type: "category",
          label: "Durability",
          items: [
            "advanced/durable-execution",
            "advanced/block-memoization-and-replay",
            "advanced/generator-and-router-suspend-resume",
          ],
        },
        {
          type: "category",
          label: "Runtime state",
          items: [
            "advanced/block-state",
            "advanced/sequencer-state",
            "advanced/state-targets-and-parents",
            "state/mutation-model",
          ],
        },
        {
          type: "category",
          label: "Integration",
          items: [
            "advanced/inbound-transports",
            "advanced/manual-flow-execution",
            "advanced/voice",
            "advanced/flow-isolation",
            "advanced/custom-model-resolver",
          ],
        },
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
        "api/benchmarks",
        "api/cli",
      ],
    },
  ],
};

export default sidebars;
