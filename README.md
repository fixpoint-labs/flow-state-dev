# flow-state-dev

flow-state-dev is a TypeScript framework for agents and agentic systems. You write typed, composable **blocks**. The framework runs them, streams items over SSE with resume, holds state in four scopes (request, session, user, org), and turns a flow into an HTTP API.

With the core packages you can ship a streaming chat or an agent with tools. Memory, patterns, a task board and coding-agent integrations compose on the same primitives when you need them. None of them are required.

It's for TypeScript developers who are building AI features and would rather compose small typed pieces than adopt a framework that decides how an agent is shaped. If you want a no-code builder, or a Python stack, this isn't it.

## What a flow looks like

```ts
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });
const sessionStateSchema = z.object({ messageCount: z.number().default(0) });

// Calls the model. History is loaded from the session.
const chat = generator({
  name: "chat",
  model: "openai/gpt-6-luna",
  prompt: "You are a helpful assistant.",
  inputSchema,
  history: true,
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
});

// Plain code. Runs after the model, bumps a counter in session state.
const countMessage = handler({
  name: "count-message",
  inputSchema: z.string(),
  sessionStateSchema,
  execute: async (_input, ctx) => {
    await ctx.session.incState({ messageCount: 1 });
  },
});

const pipeline = sequencer({ name: "chat-pipeline", inputSchema })
  .step(chat)
  .tap(countMessage);

export default defineFlow({
  kind: "my-app",
  actions: {
    chat: { block: pipeline, userMessage: (input) => input.message },
  },
  session: {
    stateSchema: sessionStateSchema,
    client: { expose: ["messageCount"] },
  },
})();
```

That is a streaming chat with conversation history and a session counter. Mount the flow on a server and it answers over HTTP; there are no routes to write.

Every block is one of five kinds, and any block can be used as a tool.

| Kind | What it does |
| --- | --- |
| **Generator** | Calls a model. Handles prompt assembly, tool loops, and streaming. |
| **Evaluator** | Asks a model typed questions (which option, what score, yes or no) and returns typed answers. |
| **Handler** | Deterministic code: validate, transform, change state, implement a tool. |
| **Sequencer** | Chains blocks: steps, parallel work, loops, rescue. A sequencer is itself a block. |
| **Router** | Picks one child block at runtime. |

## Get started in your own project

You need Node.js 22.18 or newer, a package manager, and an API key for OpenAI, Anthropic, or Google.

**Add it to an existing Next.js App Router or Node project.** Ask a coding assistant to run the [`install-fsd`](plugins/flow-state-dev/skills/install-fsd/SKILL.md) skill from your project directory. It inspects the project, shows you the list of files it will write, and leaves a dirty working tree for you to review. Or wire it by hand: [Existing project](https://flow-state.dev/docs/getting-started/existing-project).

**Build a chat from scratch.** The [Quick Start](https://flow-state.dev/docs/getting-started/quick-start) takes about five minutes. The installs are:

```bash
pnpm add @flow-state-dev/core @flow-state-dev/engine @flow-state-dev/next @flow-state-dev/react zod
pnpm add -D @flow-state-dev/fsdev

# plus the SDK for the provider you have a key for
pnpm add @ai-sdk/openai   # or @ai-sdk/anthropic, @ai-sdk/google
```

Set the matching key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`) in your shell or `.env.local`.

**Try a flow.** With a flow under `src/flows/` or `flows/`, the `fsdev` command runs it without a server or a UI:

```bash
pnpm exec fsdev run my-app chat -i '{"message": "Hello!"}'   # NDJSON events on stdout
pnpm exec fsdev dev                                          # HTTP API plus the DevTool on port 4200
```

The DevTool is a browser inspector: it lists sessions, streams items as they arrive, and dispatches actions. See the [CLI](https://flow-state.dev/docs/cli/overview) and [DevTool](https://flow-state.dev/docs/devtool/overview) docs.

## What's in the box

Everything is published under `@flow-state-dev/`. Install only what you use.

| Group | Packages |
| --- | --- |
| **Core** | [`core`](packages/core) (block builders, flows, types), [`engine`](packages/engine) (runtime, stores, SSE, HTTP routes), [`client`](packages/client) (isomorphic API client), [`react`](packages/react) (hooks and renderers) |
| **Hosting** | [`next`](packages/next), [`vercel`](packages/vercel), and [`node`](packages/node) mount a flow server. [`bullmq`](packages/bullmq) adds durable background jobs and cron for long-lived hosts. See [host adapters](https://flow-state.dev/docs/server/host-adapters) |
| **Tooling** | [`fsdev`](packages/cli) (the CLI), [`devtool`](packages/devtool) (assets served by `fsdev dev`), [`testing`](packages/testing) (harnesses and generator mocks) |
| **Persistence** | [`store-sqlite`](packages/store-sqlite) and [`store-postgres`](packages/store-postgres). See [Persistence](https://flow-state.dev/docs/persistence/overview) |
| **Building blocks** | [`memory`](packages/memory) (cross-turn memory), [`tools`](packages/tools) (reusable tool blocks), [`patterns`](packages/patterns) (supervisor, debate, plan-and-execute and others) |
| **Task boards and teams** | [`orchestration`](packages/orchestration) (tasks, dispatchers, task board, skills runtime), [`workforce`](packages/workforce) (workers built from records), [`workspace`](packages/workspace) (project files into a directory an agent works in), [`harness-manager`](packages/harness-manager) (turn a task into a supervised coding run), [`shift-manager`](packages/shift-manager) (browser app for working a task board) |
| **Coding agents** | [`claude-code`](packages/claude-code), [`codex`](packages/codex), and [`cursor`](packages/cursor) run each vendor's coding agent as a block. See [coding agents](https://flow-state.dev/docs/tools/coding-agents) |
| **Other transports** | [`mcp`](packages/mcp) (serve flows over MCP), [`scheduled`](packages/scheduled) (scheduled actions), [`voice-openai`](packages/voice-openai) (OpenAI voice) |

[`contracts`](packages/contracts) holds the shared item types and is re-exported by `core`. You rarely import it directly.

## See it working

- **[Documentation](https://flow-state.dev/docs/intro)**: concepts, guides, and API reference.
- **[`examples/hello-chat`](examples/hello-chat)**: the smallest complete flow, with React usage and tests. Start here.
- **[`examples/knowledge-base`](examples/knowledge-base)**: a frozen reference app, a personal wiki served as a secured MCP server.
- **[`apps/kitchen-sink`](apps/kitchen-sink)**: the reference app. It hosts a support desk built on Workforce and a mode for each coding agent. It needs an `AI_GATEWAY_API_KEY`; run instructions are in its [README](apps/kitchen-sink/README.md).

## Developing flow-state-dev itself

This section is for contributing to the framework. If you only want to use it, you're done above.

You need Node.js 22 or newer and pnpm 10.4.1 (`corepack enable && corepack prepare pnpm@10.4.1`).

```bash
git clone https://github.com/fixpoint-labs/flow-state-dev
cd flow-state-dev
pnpm install
pnpm packages:build   # emits dist/*.d.ts so your editor resolves workspace imports
pnpm typecheck
pnpm test
pnpm lint
```

These should pass on a fresh clone. `pnpm install` also installs a pre-push hook that runs `pnpm lint` and two vocabulary checks, and blocks the push if any fails. The first lint run takes about a minute; later runs reuse a cache.

Apps and examples run against package source, so editing a package shows up in a running app without a rebuild.

```
packages/   published packages
apps/       docs site, DevTool source, kitchen-sink, and other maintained apps
examples/   small, copy-able examples
labs/       applications built on the framework, still being worked out
plugins/    the flow-state-dev plugin, including the install-fsd skill
docs/       architecture reference and contributor guides
```

Where to read next:

- [`CONTRIBUTING.md`](CONTRIBUTING.md): how to submit a change
- [`AGENTS.md`](AGENTS.md): the working protocol and code style, for people and coding agents
- [`docs/philosophy.md`](docs/philosophy.md): the principles behind design decisions
- [`docs/architecture/overview.md`](docs/architecture/overview.md): packages and how a request flows through them
- [`docs/contributing/development-setup.md`](docs/contributing/development-setup.md): monorepo workflow, builds, tests, releases
- [`docs/contributing/best-practices.md`](docs/contributing/best-practices.md): implementation standards

Please read the [Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, follow [`SECURITY.md`](SECURITY.md).

## Sponsors

We're grateful to the sponsors who support the development of `@flow-state-dev`.

<p align="center">
  <a href="https://neon.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/sponsors/neon-logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="docs/assets/sponsors/neon-logo-light.svg">
      <img src="docs/assets/sponsors/neon-logo-light.svg" alt="Neon" width="180">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://neon.com"><strong>Neon</strong></a> — Serverless Postgres with branching, autoscaling, and scale-to-zero.
</p>

## License

MIT — see [`LICENSE`](LICENSE) for details. Copyright (c) 2026 Fixpoint Labs.
