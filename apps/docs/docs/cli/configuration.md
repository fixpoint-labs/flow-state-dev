---
sidebar_position: 3
sidebar_label: "App Configuration"
title: "App Configuration"
---

# App Configuration

`fsdev.config.ts` is a file you put at your project root that default-exports your `createFlowState` handle. A FlowState is the object `createFlowState()` returns: it holds your registered flows, your model resolver, and your store profiles, and it knows how to build the HTTP router. Your server already imports one of these to mount its API. When you also export it from `fsdev.config.ts`, the `fsdev` CLI picks it up and runs your flows with your models and your stores, the same wiring your server uses.

One file. Two entry points. No second copy of your config to keep in sync.

## Why a config file

Without a config, the CLI does its best with defaults. It discovers flows from conventional directories, resolves models from a built-in resolver keyed off environment variables, and writes to a default filesystem and SQLite store. That covers a simple app whose providers are all env-keyed.

It does not cover an app that maps intents to ordered model candidates, routes through a gateway, or uses a custom store adapter. Those live in your `createFlowState` call. Point the CLI at that call and `fsdev run` resolves models through your resolver, persists to your stores, and looks up flows in your registry. The behavior you debug from the terminal matches the behavior your server serves.

## The convention

The CLI searches the current working directory for a config file, in this precedence order:

1. `fsdev.config.ts`
2. `fsdev.config.mts`
3. `fsdev.config.js`
4. `fsdev.config.mjs`

The search is cwd-only. It does not walk up the tree. Run `fsdev` from the directory that holds the config (for a single app, the project root; in a monorepo, the app folder).

Two flags control config loading on both `fsdev run` and `fsdev dev`:

- `--config <path>` points at an explicit file, skipping the search.
- `--no-config` ignores any config and forces directory discovery (the legacy behavior).

With no config file present and no `--config`, nothing changes: the CLI falls back to directory discovery and its default stores and resolver.

The default export must be a FlowState. The CLI reads its registry, stores, and resolver directly off that handle.

```ts title="fsdev.config.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import chatFlow from "./src/flows/chat/flow";

export default createFlowState({
  flows: { chat: chatFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

## The devtool option

`createFlowState` accepts an optional `devtool: { userId?, bearerToken? }` block. Only `fsdev dev` reads it, to configure the embedded DevTool: `userId` sets the session identity DevTool acts as, and `bearerToken` is sent as `Authorization: Bearer` so a secured flow accepts the request. It is a dev-only convenience. `fsdev serve` and production deploys ignore it. See [Connecting to a secured flow](/docs/devtool/setup#connecting-to-a-secured-flow) for the full walkthrough.

## Environment files

Before the CLI imports your config, it loads `.env.local` into the environment. That ordering matters: your config constructs its model providers as it loads, and those providers read gateway and API keys at that moment. Load the env too late and the keys are already missing.

Resolution runs highest precedence first:

1. The real shell environment. Anything you've exported wins, and no file overwrites it.
2. Files you name with `--dotenv <path>`, in order.
3. `.env.local` in the working directory, then each parent up to the filesystem root.

The auto walk-up only climbs. It finds `.env.local` in cwd and above, never in a child directory. So in a monorepo, running `fsdev` from the repo root will not pick up `apps/my-app/.env.local` one level down. Point at it directly:

```bash
# from the repo root, load the app's env explicitly:
fsdev run my-flow action -i '{}' --dotenv apps/my-app/.env.local
```

`--dotenv` is repeatable and resolved relative to cwd, and absolute paths work. A file you name that doesn't exist is an error, which is the opposite of the silent walk-up: naming a file is a claim it's there, so a typo stops the run instead of vanishing.

One naming note. The flag is `--dotenv`, not `--env-file`, because Node and tsx already treat `--env-file` as a built-in flag. Under `pnpm fsdev` (which runs through tsx), Node would grab `--env-file` before the CLI ever parsed it.

The simpler alternative to all of this is to run from the app directory, where both the config and its `.env.local` sit in cwd:

```bash
cd apps/my-app && pnpm fsdev run my-flow action -i '{}'
```

## Sharing it with your server entry

Your server entry imports the same FlowState. Re-export it from a small server-entry file so both sides reference one object:

```ts title="lib/server.ts"
export { default as flowstate } from "../fsdev.config";
```

A Next.js catch-all route handler then awaits the router off that handle:

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/server";
export async function GET(req: NextRequest, ctx: RouteContext) {
  const router = await flowstate.getRouter();
  return router.GET(req, { params: await ctx.params });
}
```

Three in-repo apps ship a config and work as references. `hello-chat` is the minimal case: a couple of flows and in-memory stores, nothing else. `kitchen-sink` is the full case: multiple store profiles, intent-mapped models, and a gateway. Read whichever matches how far along your own setup is.

## What the CLI uses (and overrides)

When a config loads, the registry, store profiles, and model resolver all come from your FlowState. The CLI does not substitute its own. It does layer one thing on top: its own stderr logger, so you still get `[flow-state] *` runtime logs while it runs.

A few interactions are worth knowing:

- `--model <id>` still works with a config. The id is routed through your config's resolver, so your gateways and providers still apply. You are picking a model your resolver knows how to resolve, not bypassing it. It reaches the generators that run in this process; background work your config sends to a queue runs elsewhere, under that process's own model configuration. See [Model overrides](./overview.md#model-overrides).
- `--flow-dir` together with a config is an error. Directory discovery and a config are two different ways to find flows; mixing them is ambiguous. The error suggests `--no-config` if directory discovery is what you actually want.
- On exit, `fsdev run` disposes the config's FlowState, releasing pooled resources (database connections, for example).

Three caveats follow from running your real wiring from the terminal:

- **In-memory stores persist nothing.** If your active store profile is in-memory, a CLI run executes fine but writes nothing durable. It will not show up in your app's data afterward, because there is no shared backing store.
- **A colocated queue worker starts for the run.** If your config declares a queue worker alongside the stores (a BullMQ worker, say), a `fsdev run` starts that worker for the duration of the run and drains it on dispose.
- **Concurrent writes can lose an update.** The app and the CLI can write the same `.fsdev/data` at once. Filesystem writes are torn-write-safe across processes, so you won't read a half-written record. But two processes updating the same record can still race, and one update can be lost.

## Who a run is

Every run executes as a user in an organization, like a request to your server. `fsdev run` and
`fsdev chat` ask your app's resolver for both. That is the flow's own resolver,
`defineFlow({ authentication: { resolvePrincipal } })`, when it has one, and otherwise the
`resolvePrincipal` you passed to `createFlowState`. Whatever the resolver returns is who the run is.

Your resolver sees `source: "cli"`, with no `request` and no credential. Only `fsdev run` and
`fsdev chat` produce that source. A request from any transport that claims it, including a custom
adapter you wrote, is refused before your resolver runs. So it's safe to branch on:

```ts title="fsdev.config.ts"
resolvePrincipal: async (ctx) =>
  ctx.source === "cli"
    ? { userId: "local-dev", orgId: "acme" }
    : readSession(ctx.request),
```

With no resolver configured anywhere, a run is `cli-user` in the development organization,
`DEFAULT_ORG_ID` (`__fsd_default_org__` in output). That is also who a run is with no config at all, when flows come from directory
discovery or you pass `--no-config`. A configured resolver can't claim that organization: one that
returns `DEFAULT_ORG_ID` is refused, from the terminal as over HTTP. See
[Every request runs in an organization](/docs/server/authentication#every-request-runs-in-an-organization).

**When the resolver wants a credential.** A resolver that checks a bearer token or a signature
has nothing to check. It either throws its own error or returns `null`, and a `null` is refused
because it names no user or organization. Either way, `fsdev run` stops before it writes anything and exits
with code `2`. The error names the flow and carries the refusal's message. Here the flow's resolver
is `createBearerSecretPrincipalResolver`, which returns `null` when there's no bearer header:

```text
Flow "admin" refused this terminal: Action request requires non-empty userId
The CLI carries no credential, so a resolver that checks one refuses it. Pass --org <id> to name the organization yourself. Nothing was written.
```

Pass `--org` to say which organization to run in yourself:

```bash
fsdev run billing refund -i '{"id":"r_1"}' --org acme --user support-bot
```

`--org` skips your resolver entirely and runs as `--user`, or `cli-user` without it. It can't be
blank or `DEFAULT_ORG_ID`. `fsdev serve` and `fsdev dev` have no such flag, so requests that arrive
over the network always go through your resolver.

`--user` on its own asks your resolver as usual, keeps the organization it returns, and replaces
only the user. A resolver that refuses the terminal refuses it with `--user` too.

**Identities a run can't take.** `fsdev run` refuses each of these with exit code `2` before
anything is written:

- A session belongs to the user and organization it was created with. Resuming one with
  `--session` as anyone else is refused, as it would be over HTTP. Use a new session id.
- A [hired seat](/docs/workforce/durable-hire#who-can-reach-a-hired-seat) runs only for the owner
  it's pinned to. A run whose user or organization falls outside that pin is refused, whether the
  identity came from your resolver or from `--user` and `--org`. Name the owner with `--org`, plus
  `--user` for a seat one member owns.
- A session with no organization recorded on it is refused and left unchanged. The message points
  to the upgrade steps in
  [Which organization a record belongs to](/docs/persistence/overview#which-organization-a-record-belongs-to).

**Seeing who a run was.** Unless you pass `--quiet`, `fsdev run` prints one line to stderr before
the action runs:

```text
[fsdev] running as bob (named by --user) in organization acme-dev (from the app's resolver)
```

`--capture <path>` records the same identity under `command.principal`:

```json
{ "userId": "bob", "orgId": "acme-dev", "from": "resolver" }
```

`from` says where the organization came from: `resolver`, `flag` (`--org`), or
`development-default` (no resolver configured). It doesn't describe the user. Whether `--user`
named the user shows only on the stderr line.

## Runtime requirements

A `.ts` config needs a runtime that can load TypeScript. Inside the framework monorepo, tsx handles that. In a consumer repo, you need one of:

- Node >= 22.18, which strips TypeScript types natively.
- Run the CLI under tsx.
- Use an `fsdev.config.mjs` or `fsdev.config.js` instead.

Native type stripping ignores `tsconfig` path aliases. Keep the config's import chain on relative paths (`./src/flows/chat/flow`), not aliases like `@/flows/chat/flow`, or the import will fail to resolve.

One sharp edge: the CLI's `engines` field allows any Node 22, but type stripping is only on by default from Node 22.18. On earlier 22.x releases a `.ts` config will not load. Allowed-to-install is not the same as can-load-a-`.ts`-config. If you're on an earlier 22.x, run under tsx or ship an `.mjs` config.

## See also

- [Configuration map](/docs/configuration/overview) — every layer: flow, runtime, environment, client.
- [Runtime options](/docs/configuration/runtime) — the `createFlowState` factory field catalog.
- [Environment variables](/docs/configuration/environment) — keys, `FSD_ENV`, intent overrides.
- [Engine setup](/docs/server/setup) — the `createFlowState` factory and store profiles in narrative form.
- [Models](/docs/fundamentals/models) — model strings, intents, and how the resolver picks a provider.
- [Persistence](/docs/persistence/overview) — the store adapters and what each one durably keeps.
- [CLI API](/docs/api/cli) — the full flag reference for `fsdev run`, `fsdev dev`, and `fsdev serve`. `fsdev serve` also reads this config; it supports `--config` but not `--no-config`.
