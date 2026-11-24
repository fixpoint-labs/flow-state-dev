/**
 * The site's five sections, one sidebar each, in the page plan's reading order: Start,
 * Concepts, Catalog, Build and Reference. The navbar names each section; a category's index
 * page reads "Overview", so no label repeats its category.
 *
 * Reference ends with the generated API reference, one section per published package, served
 * by its own docs instance at `/docs/reference/api/<slug>` (see `docusaurus.config.ts`).
 */
import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";
import { listSections } from "./scripts/api-reference/packages.mjs";

const overview = (id: string) => ({ type: "doc" as const, id, label: "Overview" });

const apiSections = listSections(new URL("../..", import.meta.url).pathname).sections.map(
  ({ slug }: { slug: string }) => ({
    type: "link" as const,
    label: `@flow-state-dev/${slug}`,
    href: `/docs/reference/api/${slug}/`,
  }),
);

const sidebars: SidebarsConfig = {
  startSidebar: [
    "start/what-flow-state-is",
    "start/run-a-starter",
    "start/make-it-yours",
    "start/build-with-your-coding-agent",
    "start/add-to-an-existing-app",
  ],

  conceptsSidebar: [
    "concepts/how-it-fits-together",
    {
      type: "category",
      label: "The model",
      items: [
        "concepts/blocks",
        "concepts/generators-and-tools",
        "concepts/composition",
        "concepts/flows-and-actions",
        "concepts/sessions-items-and-streaming",
        "concepts/state-and-scopes",
        "concepts/resources",
        "concepts/views",
        "concepts/what-the-browser-sees",
        "concepts/capabilities",
        "concepts/kits-and-slots",
      ],
    },
    {
      type: "category",
      label: "Running it",
      items: [
        "concepts/serving-flows",
        "concepts/persistence",
        "concepts/pausing-resuming-and-surviving-a-crash",
        "concepts/background-work",
        "concepts/auth-and-tenancy",
        "concepts/models",
        "concepts/when-something-fails",
        "concepts/testing",
      ],
    },
    {
      type: "category",
      label: "Getting work done",
      items: ["concepts/tasks-and-boards", "concepts/workers", "concepts/coding-harnesses"],
    },
  ],

  catalogSidebar: [
    overview("catalog/index"),
    {
      type: "category",
      label: "Starters",
      items: [
        "catalog/starters/teammates",
        "catalog/starters/claude-code-style",
        "catalog/starters/shift-manager",
      ],
    },
    {
      type: "category",
      label: "Kits",
      items: [
        {
          type: "category",
          label: "Workforce",
          items: [
            overview("catalog/workforce/index"),
            "catalog/workforce/coordinators",
            "catalog/workforce/delegating-work",
            "catalog/workforce/messaging",
            "catalog/workforce/standing-rules",
            "catalog/workforce/projects",
            "catalog/workforce/the-workforce-folder",
            "catalog/workforce/screens",
            "catalog/workforce/error-reporter",
          ],
        },
        {
          type: "category",
          label: "Harnesses",
          items: [
            overview("catalog/harnesses/index"),
            "catalog/harnesses/claude-code",
            "catalog/harnesses/codex",
            "catalog/harnesses/cursor",
          ],
        },
      ],
    },
    "catalog/community",
    {
      type: "category",
      label: "Libraries",
      items: [
        {
          type: "category",
          label: "Patterns",
          items: [
            overview("catalog/patterns/index"),
            "catalog/patterns/parallel-tasks",
            "catalog/patterns/supervisor",
            "catalog/patterns/plan-and-execute",
            "catalog/patterns/debate",
            "catalog/patterns/round-robin",
            "catalog/patterns/routed-specialists",
            "catalog/patterns/event-actors",
            "catalog/patterns/response-auditor",
            "catalog/patterns/goal-seek-loop",
          ],
        },
        {
          type: "category",
          label: "Tools",
          items: [
            overview("catalog/tools/index"),
            "catalog/tools/search",
            "catalog/tools/fetch",
            "catalog/tools/crawl",
            "catalog/tools/mcp",
            "catalog/tools/bash",
            "catalog/tools/workspace",
          ],
        },
        {
          type: "category",
          label: "Memory",
          items: [
            overview("catalog/memory/index"),
            "catalog/memory/relations",
            "catalog/memory/recall-tool",
            "catalog/memory/hygiene",
          ],
        },
        {
          type: "category",
          label: "UI",
          items: [overview("catalog/ui/index"), "catalog/ui/generative"],
        },
        "catalog/skills",
        "catalog/voice",
      ],
    },
  ],

  buildSidebar: [
    {
      type: "category",
      label: "Tutorials",
      items: [
        "build/your-first-flow",
        "build/research-team",
        "build/human-in-the-loop",
        "build/debug-a-run",
      ],
    },
    {
      type: "category",
      label: "Deploy",
      items: ["build/deploy", "build/deploy/vercel", "build/deploy/railway", "build/deploy/docker"],
    },
    {
      type: "category",
      label: "Start a flow from outside",
      items: [
        "build/webhooks/stripe",
        "build/webhooks/github",
        "build/webhooks/slack",
        "build/schedules/vercel-cron",
        "build/schedules/at-run-time",
        "build/background-jobs-bullmq",
        "build/errors-to-sentry",
        "build/run-a-flow-from-code",
        "build/chat-from-the-terminal",
        "build/mcp-server",
      ],
    },
    {
      type: "category",
      label: "Build blocks and prompts",
      items: [
        "build/write-a-pattern",
        "build/prompts-in-markdown",
        "build/route-with-an-evaluator",
        "build/write-a-capability",
        "build/benchmark-patterns",
      ],
    },
    {
      type: "category",
      label: "Work with data",
      items: [
        "build/search-a-collection",
        "build/link-records",
        "build/react-to-a-change",
        "build/serve-your-own-data",
        "build/find-by-facets",
        "build/move-data-between-stores",
        "build/live-updates",
      ],
    },
    {
      type: "category",
      label: "Use the DevTool",
      items: [
        "build/embed-the-devtool",
        "build/see-resource-loads",
        "build/server-state-and-browser-state",
      ],
    },
  ],

  referenceSidebar: [
    {
      type: "category",
      label: "Building blocks",
      items: [
        "reference/blocks",
        "reference/generators",
        "reference/sequencer-methods",
        "reference/utility-blocks",
        "reference/flows",
        "reference/type-helpers",
      ],
    },
    {
      type: "category",
      label: "State, data and the stream",
      items: [
        "reference/items",
        "reference/state-operations",
        "reference/resources",
        "reference/views",
        "reference/capabilities",
        "reference/kits",
      ],
    },
    {
      type: "category",
      label: "Running it",
      items: [
        "reference/runtime",
        "reference/http-api",
        "reference/client",
        "reference/environment",
        "reference/stores",
        "reference/durable-execution",
        "reference/concurrency",
        "reference/background-work",
        "reference/authentication",
        "reference/models",
        "reference/errors",
        "reference/webhooks",
        "reference/schedules",
        "reference/mcp-server",
        "reference/voice",
      ],
    },
    {
      type: "category",
      label: "Getting work done",
      items: [
        "reference/task-board",
        "reference/task-collections",
        "reference/workforce",
        "reference/worker-messaging",
        "reference/harness-runs",
        "reference/patterns",
        "reference/tools",
        "reference/memory",
      ],
    },
    {
      type: "category",
      label: "File formats",
      items: [
        "reference/worker-md",
        "reference/workforce-folder",
        "reference/skill-md",
        "reference/markdown-templates",
      ],
    },
    {
      type: "category",
      label: "Tools for building",
      items: ["reference/cli", "reference/ui-components"],
    },
    {
      type: "category",
      label: "The site's own pages",
      items: ["reference/glossary", "reference/upgrading/2026-11-24"],
    },
    {
      type: "category",
      label: "API",
      items: apiSections,
    },
  ],
};

export default sidebars;
