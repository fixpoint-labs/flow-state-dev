---
title: Existing project
sidebar_position: 2
description: "Wire Flow State Dev into a Next.js App Router or Node project you already have."
---

# Existing project

Add a demo flow, a named set of actions the server runs, to an app you already run. A coding assistant can do the writing; you can also copy the files on this page. Either way you review a dirty working tree before you commit.

Hosts: Next.js App Router (15 or later) and plain Node. There is no `fsdev init` command.

## Ask a coding assistant

Ask a coding assistant that has the `install-fsd` skill to run it from your project directory. If yours does not, copy the files on this page.

The assistant inspects the project first. On Next.js App Router, FSD answers inside your existing server at the mount path (`/api/flows`, plus any Next `basePath`). On Node, FSD runs in a second process beside your server.

If the project is not safe to write into, the assistant stops, states each problem, and prints how to fix it. Nothing is written. Common stops include Node below 22.18, a Pages Router app, a file that already occupies the mount path, or a `package.json` that does not say which package manager you use.

The assistant asks which model provider to install: OpenAI, Anthropic, or Google. There is no default. It never asks for an API key, and it never accepts one in chat. If a key is pasted anyway, it is not written. Rotate that key and put the replacement in `.env.local` yourself.

You get a file list before anything lands. Accept it, then read the diff.

## What gets written

The run writes only the files below, and only when they are absent or already marked as generated. A file the run did not author is left alone.

**Next.js App Router**

- `fsdev.config.mts`: flows, stores, and the model resolver. Written only when no `fsdev.config.*` exists. If you already have a config, that file is left alone and the assistant hands back the one line that registers the new flow.
- `flows/hello/flow.mts`: demo flow, kind `hello`, action `send`
- `<appRoot>/api/flows/route.<ext>` and `<appRoot>/api/flows/[...path]/route.<ext>`: mount pair under the App Router root (`app` or `src/app`), with the project's route extension
- `.gitignore`: a delimited section for `.env.local` and `.fsdev/`
- `.env.local`: an empty provider-key line if you do not already have one, and a generated `FSD_DEMO_TOKEN` that is never printed, echoed, or read back
- `AGENTS.md`: a delimited section so a coding assistant knows how to write flows here

**Node**

The same list without the two route files.

`package.json` and the lockfile change only through your package manager. Authored-whole files start with `// fsd:generated`. Appended sections sit between `# flow-state-dev:start` / `# flow-state-dev:end` in `.gitignore`, or the matching HTML-comment pair in `AGENTS.md`.

## Read the diff

The working tree is left dirty so you can review it.

```bash
git status
git diff
```

Keep what you want. The generated wiring is a development setup, not a production deployment.

## After install

The assistant prints a next-steps block. Commands use your package manager and the `dev` script already in your `package.json`. They do not assume `pnpm` or port 3000.

On Next.js the block names your existing `dev` script (FSD at the mount path), `fsdev dev` for the [DevTool](/docs/devtool/setup) (a browser inspector for a running flow) in a second process, and `fsdev run hello send` to run the demo from the terminal.

On Node it names `fsdev dev` (API and DevTool together), `fsdev serve --host 127.0.0.1` (API only, bound to loopback), and the same `fsdev run hello send`. Your own server is unchanged.

If a printed port is taken, pass a different `--port`.

## The demo flow over HTTP

Kind `hello`, action `send`, input `{ userId, message }`.

A request over HTTP must carry `Authorization: Bearer $FSD_DEMO_TOKEN`. That value lives in `.env.local`. A request without it is refused (401) and no model is called. Only this flow is gated. Everything else your project serves is unchanged.

`fsdev run hello send` does not authenticate.

`fsdev dev` sends the token from `devtool.bearerToken` in the config so the DevTool can reach the closed flow. See [Connecting to a secured flow](/docs/devtool/setup#connecting-to-a-secured-flow).

## The development store

Sessions persist under `.fsdev/data` via `filesystemStores({ rootDir: ".fsdev/data", developmentOnly: true })`. Run only one FSD process against `.fsdev/data`. A second process on that directory can overwrite the first.

A shared bearer secret is not authentication for other people, and a development file store is not a database. Replace both before the project serves anyone else. See [Persistence](/docs/persistence/overview).

## Without an assistant

Copy the files below. Install through the package manager the project already uses.

### Prerequisites

- Node 22.18 or later. The CLI loads a TypeScript config with native type stripping.
- Next.js App Router 15+, or a plain Node project
- npm, pnpm, or yarn already declared for the project
- An API key for OpenAI, Anthropic, or Google, which you put in `.env.local` yourself

### Packages

Runtime: `zod`, the `@ai-sdk/*` package for your provider, `@flow-state-dev/core`, `@flow-state-dev/engine`, and `@flow-state-dev/next` on Next.js.

Dev: `@flow-state-dev/fsdev`, `@flow-state-dev/devtool`.

### Provider

Pick one. The import, the `providers` key, the env var, and `defaultModel` have to agree.

| Provider | Package | Environment variable | `defaultModel` |
| --- | --- | --- | --- |
| OpenAI | `@ai-sdk/openai` | `OPENAI_API_KEY` | `openai/gpt-5.4-mini` |
| Anthropic | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-4-6` |
| Google | `@ai-sdk/google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `google/gemini-2.5-flash` |

### Config

Write `fsdev.config.mts` only when no `fsdev.config.*` exists. If you already have a config, register `./flows/hello/flow.mts` as kind `hello` and leave the rest of that file alone.

Pass a resolver from `createModelResolver` as `modelResolver`.

```ts title="fsdev.config.mts"
import { openai } from "@ai-sdk/openai";
import { createModelResolver } from "@flow-state-dev/core/models";
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import hello from "./flows/hello/flow.mts";

const modelResolver = createModelResolver({
  providers: { openai },
  defaultModel: "openai/gpt-5.4-mini",
  intents: { chat: ["openai/gpt-5.4-mini"] },
});

export default createFlowState({
  flows: { hello },
  modelResolver,
  stores: {
    default: {
      primary: filesystemStores({
        rootDir: ".fsdev/data",
        developmentOnly: true,
      }),
    },
  },
  devtool: {
    userId: "demo",
    bearerToken: process.env.FSD_DEMO_TOKEN,
  },
});
```

Swap the import, `providers` key, env var, and `defaultModel` if you chose Anthropic or Google.

### Demo flow

```ts title="flows/hello/flow.mts"
import { defineFlow, generator } from "@flow-state-dev/core";
import {
  createBearerSecretPrincipalResolver,
  PrincipalResolutionError,
} from "@flow-state-dev/engine";
import { z } from "zod";

const inputSchema = z.object({
  userId: z.string(),
  message: z.string(),
});

const chat = generator({
  name: "chat",
  model: "intent/chat",
  prompt: "You are a helpful assistant.",
  inputSchema,
  history: true,
  user: (input) => input.message,
});

function resolveDemoPrincipal(context: { request?: Request }) {
  const secret = process.env.FSD_DEMO_TOKEN;
  if (!secret) {
    throw new PrincipalResolutionError("Demo flow is closed. Set FSD_DEMO_TOKEN.", {
      status: 401,
    });
  }
  const principal = createBearerSecretPrincipalResolver({
    secret,
    principal: { userId: "demo" },
  })(context);
  if (principal === null) {
    throw new PrincipalResolutionError("Demo flow is closed. Send Authorization: Bearer.", {
      status: 401,
    });
  }
  return principal;
}

export default defineFlow({
  kind: "hello",
  authentication: {
    resolvePrincipal: resolveDemoPrincipal,
    requireUser: true,
  },
  actions: {
    send: {
      inputSchema,
      block: chat,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: z.object({}),
  },
})();
```

### Next.js mount

Skip this section on Node. Both files export `createNextHandler` from `@flow-state-dev/next`. The bare file answers `GET /api/flows` (zero path segments). The catch-all answers everything under that path. Adjust the relative import if your App Router lives under `src/app`.

```ts title="app/api/flows/[...path]/route.ts"
import { createNextHandler } from "@flow-state-dev/next";
import flowstate from "../../../../fsdev.config.mts";

export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate);
export const dynamic = "force-dynamic";
```

```ts title="app/api/flows/route.ts"
import { createNextHandler } from "@flow-state-dev/next";
import flowstate from "../../../fsdev.config.mts";

const handler = createNextHandler(flowstate);

export function GET(req: Request) {
  return handler.GET(req, { params: Promise.resolve({ path: [] }) });
}

export function POST(req: Request) {
  return handler.POST(req, { params: Promise.resolve({ path: [] }) });
}

export function PATCH(req: Request) {
  return handler.PATCH(req, { params: Promise.resolve({ path: [] }) });
}

export function DELETE(req: Request) {
  return handler.DELETE(req, { params: Promise.resolve({ path: [] }) });
}
```

On Vercel, `createVercelNextHandler` from `@flow-state-dev/vercel/next` is the same mount shape with SSE shaping. See [Next.js Setup](/guides/nextjs-setup).

### Ignore rules and secrets

Append this section to `.gitignore` (create the file if it is missing):

```gitignore
# flow-state-dev:start
.env.local
.fsdev/
# flow-state-dev:end
```

In `.env.local`, add an empty line for your provider key if that variable is not already present, and a `FSD_DEMO_TOKEN=` line. Put a long random string on the token line yourself. Put the provider key on its line yourself. Do not commit `.env.local`. Do not paste either value into a chat.

`AGENTS.md` is optional if you are not using a coding assistant. The skill appends a delimited section there; you can skip it.

### Run it

Use your package manager. npm and yarn need `--` before flags that start with `-`.

On Next.js, start the app the way you already do (`npm run dev`, `pnpm run dev`, `yarn run dev`, or whatever script name `package.json` actually uses). Then, from the project directory:

```bash
pnpm exec fsdev dev --port 4210
pnpm exec fsdev run hello send --input '{"userId":"u1","message":"hi"}'
```

On Node:

```bash
pnpm exec fsdev dev --port 4210
pnpm exec fsdev serve --host 127.0.0.1 --port 4211
pnpm exec fsdev run hello send --input '{"userId":"u1","message":"hi"}'
```

Keep `--host 127.0.0.1` on `fsdev serve`. It binds the listener to loopback. If 4210 or 4211 is taken, pass a different `--port`.

## Related

- [Quick Start](/docs/getting-started/quick-start) — a chat built from scratch
- [Setting Up Models](/docs/getting-started/setting-up-models) — keys, intents, gateways
- [DevTool setup](/docs/devtool/setup) — inspect the demo flow in the browser
- [App Configuration](/docs/cli/configuration) — `fsdev.config.*` and how the CLI loads it
- [Persistence](/docs/persistence/overview) — store adapters to replace the development file store
- [Authentication](/docs/server/authentication) — principals, `requireUser`, bearer resolvers
