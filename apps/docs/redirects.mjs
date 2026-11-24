/**
 * Every address of the site before its five sections (Start, Concepts, Catalog, Build,
 * Reference), mapped to the page that holds its topic. Read by
 * `@docusaurus/plugin-client-redirects` in `docusaurus.config.ts`.
 *
 * Each old page goes to the page its topic moved to, as the page plan's sources say; one whose
 * topic was cut goes to the closest page in its section. Addresses are paths on the site, without
 * a trailing slash; a target that is a section's index page keeps its trailing slash, as
 * Docusaurus serves it. The build fails if a site target is not a page the site serves. A
 * contributor guide that left the site goes to its file in the repository.
 */

/** The current Upgrading page. Every earlier `reference/upgrading/<date>` address goes here. */
const UPGRADING = "/docs/reference/upgrading/2026-11-24";

/** Earlier Upgrading pages, removed when a later release wrote its own. */
const EARLIER_UPGRADING = [];

/** Old address → new address. */
const OLD_ADDRESSES = {
  // Docs root and the old introduction
  "/docs/intro": "/docs/start/what-flow-state-is",
  "/docs/glossary": "/docs/reference/glossary",

  // advanced/
  "/docs/advanced/block-memoization-and-replay": "/docs/concepts/pausing-resuming-and-surviving-a-crash",
  "/docs/advanced/block-state": "/docs/concepts/state-and-scopes",
  "/docs/advanced/capabilities-authoring": "/docs/build/write-a-capability",
  "/docs/advanced/concurrency-policies": "/docs/reference/concurrency",
  "/docs/advanced/custom-model-resolver": "/docs/reference/models",
  "/docs/advanced/durable-execution": "/docs/concepts/pausing-resuming-and-surviving-a-crash",
  "/docs/advanced/error-capture": "/docs/concepts/when-something-fails",
  "/docs/advanced/error-handling": "/docs/concepts/when-something-fails",
  "/docs/advanced/flow-isolation": "/docs/reference/flows",
  "/docs/advanced/generator-and-router-suspend-resume": "/docs/build/human-in-the-loop",
  "/docs/advanced/generator-context": "/docs/reference/generators",
  "/docs/advanced/generator-prompts-markdown": "/docs/build/prompts-in-markdown",
  "/docs/advanced/idempotency": "/docs/concepts/pausing-resuming-and-surviving-a-crash",
  "/docs/advanced/inbound-transports": "/docs/reference/webhooks",
  "/docs/advanced/manual-flow-execution": "/docs/build/run-a-flow-from-code",
  "/docs/advanced/resource-templates-markdown": "/docs/reference/markdown-templates",
  "/docs/advanced/sequencer-side-chains": "/docs/reference/sequencer-methods",
  "/docs/advanced/sequencer-state": "/docs/reference/blocks",
  "/docs/advanced/state-targets-and-parents": "/docs/reference/blocks",
  "/docs/advanced/utility-blocks-deprecated": "/docs/reference/utility-blocks",
  "/docs/advanced/voice": "/docs/catalog/voice",

  // api/ (the hand-written API pages; the generated reference takes their place)
  "/docs/api/benchmarks": "/docs/reference/api/testing/",
  "/docs/api/cli": "/docs/reference/cli",
  "/docs/api/client": "/docs/reference/api/client/",
  "/docs/api/core": "/docs/reference/api/core/",
  "/docs/api/react": "/docs/reference/api/react/",
  "/docs/api/server": "/docs/reference/api/engine/",
  "/docs/api/testing": "/docs/reference/api/testing/",

  // cli/
  "/docs/cli/agent-dev-loop": "/docs/start/build-with-your-coding-agent",
  "/docs/cli/configuration": "/docs/reference/cli",
  "/docs/cli/interactive-chat": "/docs/build/chat-from-the-terminal",
  "/docs/cli/overview": "/docs/reference/cli",

  // client/
  "/docs/client/overview": "/docs/concepts/what-the-browser-sees",
  "/docs/client/react": "/docs/concepts/what-the-browser-sees",

  // configuration/
  "/docs/configuration/blocks": "/docs/reference/blocks",
  "/docs/configuration/client": "/docs/reference/client",
  "/docs/configuration/environment": "/docs/reference/environment",
  "/docs/configuration/flow": "/docs/reference/flows",
  "/docs/configuration/overview": "/docs/reference/runtime",
  "/docs/configuration/runtime": "/docs/reference/runtime",

  // devtool/
  "/docs/devtool/debug-vs-client-state": "/docs/build/server-state-and-browser-state",
  "/docs/devtool/embedding": "/docs/build/embed-the-devtool",
  "/docs/devtool/observing-resource-loads": "/docs/build/see-resource-loads",
  "/docs/devtool/overview": "/docs/build/debug-a-run",
  "/docs/devtool/setup": "/docs/build/debug-a-run",

  // ecosystem/
  "/docs/ecosystem/overview": "/docs/catalog/",

  // fundamentals/
  "/docs/fundamentals/actions": "/docs/concepts/flows-and-actions",
  "/docs/fundamentals/blocks": "/docs/concepts/blocks",
  "/docs/fundamentals/capabilities": "/docs/concepts/capabilities",
  "/docs/fundamentals/flows": "/docs/concepts/flows-and-actions",
  "/docs/fundamentals/models": "/docs/concepts/models",
  "/docs/fundamentals/overview": "/docs/concepts/how-it-fits-together",
  "/docs/fundamentals/state-and-scopes": "/docs/concepts/state-and-scopes",
  "/docs/fundamentals/state-operations": "/docs/reference/state-operations",
  "/docs/fundamentals/type-system": "/docs/concepts/blocks",

  // getting-started/
  "/docs/getting-started/existing-project": "/docs/start/add-to-an-existing-app",
  "/docs/getting-started/installation": "/docs/start/run-a-starter",
  "/docs/getting-started/project-structure": "/docs/build/your-first-flow",
  "/docs/getting-started/quick-start": "/docs/start/run-a-starter",
  "/docs/getting-started/setting-up-models": "/docs/concepts/models",
  "/docs/getting-started/your-first-flow": "/docs/build/your-first-flow",

  // memory/
  "/docs/memory/configuration": "/docs/reference/memory",
  "/docs/memory/hygiene": "/docs/catalog/memory/hygiene",
  "/docs/memory/overview": "/docs/catalog/memory/",
  "/docs/memory/recall-tool": "/docs/catalog/memory/recall-tool",
  "/docs/memory/relations": "/docs/catalog/memory/relations",

  // orchestration/
  "/docs/orchestration/agents": "/docs/concepts/tasks-and-boards",
  "/docs/orchestration/configuration": "/docs/reference/task-board",
  "/docs/orchestration/discovery": "/docs/catalog/workforce/",
  "/docs/orchestration/flow-policy": "/docs/reference/task-collections",
  "/docs/orchestration/goal-seek-loop": "/docs/catalog/patterns/goal-seek-loop",
  "/docs/orchestration/harness-manager": "/docs/catalog/harnesses/",
  "/docs/orchestration/overview": "/docs/concepts/tasks-and-boards",
  "/docs/orchestration/task-board": "/docs/concepts/tasks-and-boards",
  "/docs/orchestration/task-substrate": "/docs/reference/task-collections",
  "/docs/orchestration/workers-on-disk": "/docs/catalog/workforce/the-workforce-folder",

  // patterns/
  "/docs/patterns/debate": "/docs/catalog/patterns/debate",
  "/docs/patterns/event-actors": "/docs/catalog/patterns/event-actors",
  "/docs/patterns/flow-policy": "/docs/reference/task-collections",
  "/docs/patterns/overview": "/docs/catalog/patterns/",
  "/docs/patterns/parallelTasks": "/docs/catalog/patterns/parallel-tasks",
  "/docs/patterns/plan-and-execute": "/docs/catalog/patterns/plan-and-execute",
  "/docs/patterns/response-auditor": "/docs/catalog/patterns/response-auditor",
  "/docs/patterns/round-robin": "/docs/catalog/patterns/round-robin",
  "/docs/patterns/routed-specialists": "/docs/catalog/patterns/routed-specialists",
  "/docs/patterns/supervisor": "/docs/catalog/patterns/supervisor",
  "/docs/patterns/task-board": "/docs/concepts/tasks-and-boards",
  "/docs/patterns/utility-blocks/core": "/docs/reference/utility-blocks",

  // persistence/
  "/docs/persistence/overview": "/docs/concepts/persistence",

  // resources/
  "/docs/resources/client-access": "/docs/concepts/resources",
  "/docs/resources/collections": "/docs/concepts/resources",
  "/docs/resources/edges": "/docs/build/link-records",
  "/docs/resources/manifest": "/docs/reference/resources",
  "/docs/resources/overview": "/docs/concepts/resources",
  "/docs/resources/projected-collections": "/docs/build/serve-your-own-data",
  "/docs/resources/reactive-blocks": "/docs/build/react-to-a-change",
  "/docs/resources/searching": "/docs/build/search-a-collection",
  "/docs/resources/storage": "/docs/concepts/resources",

  // sequencers/
  "/docs/sequencers/composing-blocks": "/docs/concepts/composition",
  "/docs/sequencers/connectors": "/docs/reference/sequencer-methods",
  "/docs/sequencers/control-flow": "/docs/reference/sequencer-methods",
  "/docs/sequencers/overview": "/docs/concepts/composition",
  "/docs/sequencers/wait-for-condition": "/docs/reference/sequencer-methods",

  // server/
  "/docs/server/authentication": "/docs/concepts/auth-and-tenancy",
  "/docs/server/background-work": "/docs/reference/background-work",
  "/docs/server/connection-resilience": "/docs/concepts/sessions-items-and-streaming",
  "/docs/server/host-adapters": "/docs/concepts/serving-flows",
  "/docs/server/mcp": "/docs/build/mcp-server",
  "/docs/server/schedule-index": "/docs/reference/schedules",
  "/docs/server/scheduled": "/docs/reference/schedules",
  "/docs/server/setup": "/docs/concepts/serving-flows",
  "/docs/server/webhooks": "/docs/reference/webhooks",

  // shift-manager/ (from-a-checkout moved to contributor docs)
  "/docs/shift-manager/from-a-checkout": "https://github.com/fixpoint-labs/flow-state-dev/blob/main/docs/contributing/shift-manager-from-a-checkout.md",
  "/docs/shift-manager/overview": "/docs/catalog/starters/shift-manager",
  "/docs/shift-manager/settings": "/docs/catalog/starters/shift-manager",

  // skills/
  "/docs/skills/activation": "/docs/catalog/skills",
  "/docs/skills/authoring": "/docs/reference/skill-md",
  "/docs/skills/binding": "/docs/catalog/skills",
  "/docs/skills/overview": "/docs/catalog/skills",
  "/docs/skills/pattern-skills": "/docs/catalog/skills",

  // state/
  "/docs/state/mutation-model": "/docs/reference/state-operations",

  // streaming/
  "/docs/streaming/emitting-items": "/docs/concepts/sessions-items-and-streaming",
  "/docs/streaming/items": "/docs/reference/items",
  "/docs/streaming/overview": "/docs/concepts/sessions-items-and-streaming",
  "/docs/streaming/trace-channel": "/docs/build/debug-a-run",

  // testing/ (the two contributor pages moved to contributor docs)
  "/docs/testing/benchmarks": "/docs/build/benchmark-patterns",
  "/docs/testing/end-to-end-tests": "https://github.com/fixpoint-labs/flow-state-dev/blob/main/docs/contributing/end-to-end-tests.md",
  "/docs/testing/flow-integration-tests": "https://github.com/fixpoint-labs/flow-state-dev/blob/main/docs/contributing/flow-integration-tests.md",
  "/docs/testing/overview": "/docs/concepts/testing",
  "/docs/testing/testing-flows": "/docs/concepts/testing",

  // tools/
  "/docs/tools/bash": "/docs/catalog/tools/bash",
  "/docs/tools/claude-code-cli": "/docs/catalog/harnesses/claude-code",
  "/docs/tools/claude-code-sdk": "/docs/catalog/harnesses/claude-code",
  "/docs/tools/codex": "/docs/catalog/harnesses/codex",
  "/docs/tools/coding-agents": "/docs/concepts/coding-harnesses",
  "/docs/tools/crawl": "/docs/catalog/tools/crawl",
  "/docs/tools/cursor": "/docs/catalog/harnesses/cursor",
  "/docs/tools/fetch": "/docs/catalog/tools/fetch",
  "/docs/tools/mcp": "/docs/catalog/tools/mcp",
  "/docs/tools/overview": "/docs/catalog/tools/",
  "/docs/tools/search": "/docs/catalog/tools/search",
  "/docs/tools/workspace": "/docs/catalog/tools/workspace",

  // ui/
  "/docs/ui/common-components": "/docs/reference/ui-components",
  "/docs/ui/flow-aware-components": "/docs/reference/ui-components",
  "/docs/ui/generative": "/docs/catalog/ui/generative",
  "/docs/ui/overview": "/docs/catalog/ui/",

  // workforce/
  "/docs/workforce/built-in-worker": "/docs/catalog/workforce/",
  "/docs/workforce/capabilities-on-disk": "/docs/catalog/workforce/the-workforce-folder",
  "/docs/workforce/channels": "/docs/catalog/workforce/coordinators",
  "/docs/workforce/chief-of-staff": "/docs/catalog/starters/shift-manager", // retired-name-refusal: an old docs link keeps landing on the page
  "/docs/workforce/code-on-disk": "/docs/catalog/workforce/the-workforce-folder",
  "/docs/workforce/coordinators": "/docs/catalog/workforce/coordinators",
  "/docs/workforce/delegating-work": "/docs/catalog/workforce/delegating-work",
  "/docs/workforce/documents-on-disk": "/docs/catalog/workforce/the-workforce-folder",
  "/docs/workforce/durable-hire": "/docs/concepts/workers",
  "/docs/workforce/error-reporter": "/docs/catalog/workforce/error-reporter",
  "/docs/workforce/inventory": "/docs/catalog/workforce/",
  "/docs/workforce/mailboxes": "/docs/catalog/workforce/coordinators",
  "/docs/workforce/messaging-workers": "/docs/catalog/workforce/messaging",
  "/docs/workforce/overview": "/docs/concepts/workers",
  "/docs/workforce/packages-on-disk": "/docs/catalog/workforce/the-workforce-folder",
  "/docs/workforce/projects": "/docs/catalog/workforce/projects",
  "/docs/workforce/shift-coordinator": "/docs/catalog/starters/shift-manager",
  "/docs/workforce/standing-rules": "/docs/catalog/workforce/standing-rules",
  "/docs/workforce/ui": "/docs/catalog/workforce/screens",
  "/docs/workforce/worker-usage": "/docs/reference/workforce",
  "/docs/workforce/workers-on-disk": "/docs/catalog/workforce/the-workforce-folder",

  // guides/ (the Guides section is gone; Build holds its recipes and tutorials)
  "/guides/adding-skills-to-your-app": "/docs/catalog/skills",
  "/guides/anatomy-of-a-flow": "/docs/concepts/how-it-fits-together",
  "/guides/background-jobs-bullmq": "/docs/build/background-jobs-bullmq",
  "/guides/background-work": "/docs/concepts/background-work",
  "/guides/board-lifecycle": "/docs/concepts/tasks-and-boards",
  "/guides/building-a-chat-app": "/docs/build/your-first-flow",
  "/guides/building-a-research-team": "/docs/build/research-team",
  "/guides/building-agents": "/docs/concepts/generators-and-tools",
  "/guides/choosing-patterns-with-benchmarks": "/docs/catalog/patterns/",
  "/guides/create-your-own-pattern": "/docs/build/write-a-pattern",
  "/guides/deploying-to-aws-lambda": "/docs/build/deploy",
  "/guides/deploying-to-railway": "/docs/build/deploy/railway",
  "/guides/deploying-to-vercel": "/docs/build/deploy/vercel",
  "/guides/deploying-with-docker": "/docs/build/deploy/docker",
  "/guides/deployment": "/docs/build/deploy",
  "/guides/development-tips": "/docs/build/debug-a-run",
  "/guides/human-in-the-loop": "/docs/build/human-in-the-loop",
  "/guides/keeping-a-flow-running": "/docs/concepts/background-work",
  "/guides/nextjs-setup": "/docs/start/add-to-an-existing-app",
  "/guides/projects-on-org-scope": "/docs/concepts/state-and-scopes",
  "/guides/prompts-as-markdown": "/docs/build/prompts-in-markdown",
  "/guides/realtime": "/docs/build/live-updates",
  "/guides/routing-errors-to-sentry": "/docs/build/errors-to-sentry",
  "/guides/routing-with-evaluators": "/docs/build/route-with-an-evaluator",
  "/guides/scheduled-cloud-scheduler": "/docs/build/schedules/vercel-cron",
  "/guides/scheduled-dynamic": "/docs/build/schedules/at-run-time",
  "/guides/scheduled-eventbridge": "/docs/build/schedules/vercel-cron",
  "/guides/scheduled-vercel-cron": "/docs/build/schedules/vercel-cron",
  "/guides/webhooks-github": "/docs/build/webhooks/github",
  "/guides/webhooks-slack-events": "/docs/build/webhooks/slack",
  "/guides/webhooks-stripe": "/docs/build/webhooks/stripe",
  "/guides/writing-ui-stories": "https://github.com/fixpoint-labs/flow-state-dev/blob/main/docs/contributing/writing-ui-stories.md",
};

/** The list `@docusaurus/plugin-client-redirects` takes. */
export const redirects = [
  ...Object.entries(OLD_ADDRESSES).map(([from, to]) => ({ from, to })),
  ...EARLIER_UPGRADING.map((from) => ({ from, to: UPGRADING })),
];
