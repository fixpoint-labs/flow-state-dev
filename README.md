# Flow State

Flow State lets you start from a working app with a full agentic backend and make it your own. The backend is already there: workers that take on tasks, a task board they share with you, state and memory kept in your own stores, output streamed to the browser as it is written, and any model you have a key for. Use its flows as they are, or change them to fit how you work.

You own the code. Nothing runs on someone else's harness, so you pick the model for each step, keep the data in systems you run, and run plain code wherever a model isn't needed.

It is open source, written in TypeScript, and runs as a web service. It is also an early preview: the starters are research software, and each one's README lists what isn't wired yet.

Today it's for developers. Where it's heading is apps that people who don't write code install and then reshape by asking the app to rewrite or reconfigure itself. That isn't here yet; [flow-state.build](https://www.flow-state.build) is where it will show up.

Docs: [flow-state.dev/docs](https://flow-state.dev/docs/intro).

## Starters

A starter is a complete app: React pages, a team of workers, and the flows they run on. Every starter runs on the same backend packages, so what differs between them is mostly the UI and the workers' files.

- **[Teammates](labs/teammates)** (`labs/teammates`): a Grok Bot-style team. Chief of Staff, researcher and writer each keep one long conversation, message each other where you can see it, and hand code changes to a coding agent (Claude Code, Codex or Cursor) that runs in the background. You can hire teammates of your own from the page.
- **[Claude Code-style agent](labs/claude-code-style)** (`labs/claude-code-style`): one conversation driving an agent loop. The main session answers questions about your project itself and starts background tasks for the long pieces. Code changes go to a coding agent, and in threads mode a run that changed files waits for you to accept it or ask for changes.

Shift Manager, an app for working a whole team's asks, tasks and workstreams, is in progress. An early version is in [`packages/shift-manager`](packages/shift-manager), where several screens are placeholders; see its [docs](https://flow-state.dev/docs/shift-manager/overview).

For now the starters run from a clone of this repository. They are workspace packages that depend on the framework's source, not something you install from npm.

## Run a starter

You need Node.js 22.18 or newer and pnpm 10.4.1 (`corepack enable && corepack prepare pnpm@10.4.1`).

```bash
git clone https://github.com/fixpoint-labs/flow-state-dev
cd flow-state-dev
pnpm install

pnpm --filter @flow-state-dev/teammates dev
# or
pnpm --filter @flow-state-dev/claude-code-style dev
```

Each command builds the starter's pages and serves them with its backend. Open the address it prints as `App:` (`http://localhost:4200` by default). It also prints a `DevTool:` address, a browser inspector that shows every run, item and state change as it happens.

Set keys in your shell or in a `.env.local` at the repository root:

| Key | Needed for |
| --- | --- |
| `AI_GATEWAY_API_KEY` | The model every worker answers on. Both starters need it. |
| Claude Code signed in, or `ANTHROPIC_API_KEY` | Coding tasks on Claude Code. The Claude Code-style starter's default coder runs on it. |
| Codex signed in (`codex login`), or `CODEX_API_KEY` | Coding tasks on Codex. |
| Cursor signed in, or `CURSOR_API_KEY` | Coding tasks on Cursor. Teammates' default coder runs on it. |
| `TAVILY_API_KEY`, `EXA_API_KEY` or `BRAVE_API_KEY` | Optional. Teammates' researcher uses one to search the web. |

You only need the coding-agent sign-ins for the coding workers. At startup each starter logs which coding agents this machine can run and what to run for any that can't.

Both starters keep their data in a SQLite file under `.fsdev/`, so conversations and tasks survive a restart. Coding tasks run in a git worktree of the repository, on a branch of their own, so your checkout isn't touched. By default that repository is this clone; Teammates takes `TEAMMATES_WORKDIR` to point at another checkout. The full list of settings, and a first conversation to try, is in each starter's README: [Teammates](labs/teammates/README.md#run-it), [Claude Code-style](labs/claude-code-style/README.md#run-it).

## Make it yours

Most of what makes a starter itself lives in plain files you can edit.

**Workers are `WORKER.md` files.** Each one sits in its own folder under the starter's `workforce/teams/<team>/workers/<name>/`. The frontmatter says who the worker is and what it can use; the body is its instructions. Here is Teammates' researcher, from [`labs/teammates/workforce/teams/teammates/workers/researcher/WORKER.md`](labs/teammates/workforce/teams/teammates/workers/researcher/WORKER.md):

```md
---
name: researcher
description: Finds facts for the team, in the working folder's files and on the web, and replies to whoever asked.
icon: "🔎"
color: teal
tools: [globProjectSource, readProjectSource, grepProjectSource, search, fetch]
---

You find facts: dates, prices, what a document or the code says. Look them up, never guess: read the
working folder's files with `globProjectSource`, `grepProjectSource` and `readProjectSource`, and
search the web with `search` and `fetch`. Say where each fact came from: the file's path, or the
page's URL.
```

`description` is the only required key. `name` is the display name, `tools` lists the tools it may call, and `flow` picks which flow it runs on. A starter's flow can accept its own settings on top: Teammates reads `icon` and `color` for the worker list, and its coding workers name a `harness:` (`claude-code`, `codex` or `cursor`). Add a folder and you've added a worker. Edit the body and its instructions change on the next start.

**The team is `TEAM.md`.** It sits at the top of the team's folder and holds what every worker on the team is told, such as which codebase they work on.

**Flows are TypeScript.** When a worker needs to do something the existing flows don't, write a flow of your own and point the worker at it with `flow:`. The Claude Code-style starter keeps its own in `labs/claude-code-style/workforce/flows/`. Workers can also load skills, Markdown playbooks they pull in when a task calls for one.

**The UI is a React app.** Each starter's pages are under its `src/`, built with Vite. They call the backend through typed hooks from `@flow-state-dev/react`, and some components come from the Flow State UI registry, copied into `src/components/flow-state/` so you can edit them like any other file.

Read more:

- [Workforce](https://flow-state.dev/docs/workforce/overview) and [Workers on disk](https://flow-state.dev/docs/workforce/workers-on-disk): every `WORKER.md` and `TEAM.md` key
- [Flows](https://flow-state.dev/docs/fundamentals/flows)
- [Skills](https://flow-state.dev/docs/skills/overview)
- [React](https://flow-state.dev/docs/client/react) and the [UI registry](https://flow-state.dev/docs/ui/overview)

## Add it to an app you already have

Flow State also mounts inside an existing Next.js App Router or Node project.

Ask your coding assistant to run the [`install-fsd`](plugins/flow-state-dev/skills/install-fsd/SKILL.md) skill from your project directory. It inspects the project, shows you the files it will write, then writes them. It doesn't commit, so review the result with `git diff`. To wire it by hand, follow [Existing project](https://flow-state.dev/docs/getting-started/existing-project). The [Quick Start](https://flow-state.dev/docs/getting-started/quick-start) builds a streaming chat with a React UI from nothing.

The core install is:

```bash
pnpm add @flow-state-dev/core @flow-state-dev/engine zod
```

## Underneath

The starters are built on a foundation you can use directly. You compose **blocks**, typed units that range from a model call to plain code, checks and routing, into **flows**, sets of named actions a client can call. State and documents are typed and scoped to a session, user or org, on the store you choose. Runs are durable, so long work survives a restart and resumes where it stopped. You pick the model per block, and loops and coding runs stop at the limits you set. On the front end, a client SDK and React hooks read the same types, and the DevTool shows every run as it happens.

Everything is published under `@flow-state-dev/`. Install only what you use.

| Group | Packages |
| --- | --- |
| **Core** | [`core`](packages/core) (blocks, flows, types), [`engine`](packages/engine) (runtime, stores, streaming, HTTP routes), [`client`](packages/client) (API client for browsers and Node), [`react`](packages/react) (hooks and renderers), [`contracts`](packages/contracts) (shared item types, re-exported by `core`) |
| **Workers and tasks** | [`orchestration`](packages/orchestration) (task board, skills), [`workforce`](packages/workforce) (workers and `WORKER.md`), [`workspace`](packages/workspace) (a directory a worker edits files in), [`harness-manager`](packages/harness-manager) (a task run as a supervised coding session), [`shift-manager`](packages/shift-manager) (browser app for a team) |
| **Coding agents** | [`claude-code`](packages/claude-code), [`codex`](packages/codex), [`cursor`](packages/cursor) |
| **Building blocks** | [`memory`](packages/memory), [`tools`](packages/tools), [`patterns`](packages/patterns) |
| **Hosting** | [`next`](packages/next), [`vercel`](packages/vercel), [`node`](packages/node), [`bullmq`](packages/bullmq) (durable background jobs and cron) |
| **Persistence** | [`store-sqlite`](packages/store-sqlite), [`store-postgres`](packages/store-postgres) |
| **Transports** | [`mcp`](packages/mcp), [`scheduled`](packages/scheduled), [`voice-openai`](packages/voice-openai) |
| **Tooling** | [`fsdev`](packages/cli) (the CLI), [`devtool`](packages/devtool), [`testing`](packages/testing) (harnesses and mock models) |

Concepts, guides and API reference are in the [docs](https://flow-state.dev/docs/intro). For small, copy-able code, see [`examples/hello-chat`](examples/hello-chat).

## Developing Flow State itself

For contributors to the framework.

```bash
git clone https://github.com/fixpoint-labs/flow-state-dev
cd flow-state-dev
pnpm install
pnpm packages:build   # emits dist/*.d.ts so your editor resolves workspace imports
pnpm typecheck
pnpm test
pnpm lint
```

These should pass on a fresh clone. `pnpm install` also installs a pre-push hook that runs `pnpm lint` and the repo's naming checks, and blocks the push if any fails. See [development setup](docs/contributing/development-setup.md).

Apps, starters and examples run against package source, so a package edit shows up in a running app without a rebuild.

```
packages/   published packages
apps/       docs site, DevTool source, kitchen-sink, and other maintained apps
labs/       the starters and other experimental apps
examples/   small, copy-able examples
plugins/    the flow-state-dev plugin, including the install-fsd skill
docs/       architecture reference and contributor guides
```

Where to read next:

- [`CONTRIBUTING.md`](CONTRIBUTING.md): how to submit a change
- [`AGENTS.md`](AGENTS.md): the working protocol and code style, for people and coding agents
- [`docs/philosophy.md`](docs/philosophy.md): the principles behind design decisions
- [`docs/architecture/overview.md`](docs/architecture/overview.md): packages and how a request flows through them
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
  <a href="https://neon.com"><strong>Neon</strong></a>: serverless Postgres with branching, autoscaling, and scale-to-zero.
</p>

## License

MIT. See [`LICENSE`](LICENSE) for details. Copyright (c) 2026 Fixpoint Labs.
