# Wiring contract

What a project wired up with FSD must satisfy. Both entry paths — this skill (brownfield) and `create-flow-state` (greenfield) — conform to this shape. Their outputs are allowed to differ (a chat page, a different flow name, a missing mount on Node). The observables below are not.

## Runtime floor

Node **22.18** or newer. The CLI loads a TypeScript config with native type stripping. A `>=22` check is the wrong number: 22.0–22.17 pass it and then fail every printed command.

## Config file

Brownfield writes `fsdev.config.mts` only when no `fsdev.config.*` of any extension exists. The extension is required on this path: the project's `package.json` `type` is not ours to change, and `.mts` loads cleanly in `module`, `commonjs`, and unset. Greenfield may write `fsdev.config.ts` because it authors the manifest.

The config calls `createFlowState` with:

- `flows` — an explicit registry. The demo flow is kind `hello`, module `./flows/hello/flow.mts`.
- `stores` — required. At least one named profile. The development default is `filesystemStores({ rootDir: ".fsdev/data", developmentOnly: true })`. Marked as a development store in the file and in the next-steps block. Replace it before the project serves anyone else.
- `modelResolver` — a pre-built resolver from `createModelResolver`, passed as `modelResolver`. Never the `models` shorthand. Next bundles server code and breaks the dynamic provider path.
- `devtool` — `{ userId: "demo", bearerToken: process.env.FSD_DEMO_TOKEN }` so `fsdev dev` can reach the closed demo flow.

When the project already has a config, do not write one. Register the new flow in theirs. Auth for the demo stays on that flow alone — do not add a host-level `resolvePrincipal` to a config you did not write.

## Provider wiring

The provider is imported statically and passed in `createModelResolver({ providers, defaultModel })`.

| provider    | static import                         | env var                        | `defaultModel`                |
| ----------- | ------------------------------------- | ------------------------------ | ----------------------------- |
| `openai`    | `import { openai } from "@ai-sdk/openai"` | `OPENAI_API_KEY`           | `openai/gpt-5.4-mini`         |
| `anthropic` | `import { anthropic } from "@ai-sdk/anthropic"` | `ANTHROPIC_API_KEY`  | `anthropic/claude-sonnet-4.6` |
| `google`    | `import { google } from "@ai-sdk/google"` | `GOOGLE_GENERATIVE_AI_API_KEY` | `google/gemini-2.5-flash` |

## Demo flow

Kind `hello`, action `send`, input `{ userId, message }`. Closed over HTTP: `authentication.resolvePrincipal` is `createBearerSecretPrincipalResolver` against `FSD_DEMO_TOKEN`. A request without `Authorization: Bearer $FSD_DEMO_TOKEN` is refused and no model call is made. `fsdev run` does not authenticate. Only this flow is gated.

`FSD_DEMO_TOKEN` is generated into `.env.local`. Never printed, echoed, or read back.

## Next.js mount pair

Two files under the detected app root, with the detected route extension:

- `<appRoot>/api/flows/[...path]/route.<ext>` — `createNextHandler(flowstate)` from `@flow-state-dev/next`
- `<appRoot>/api/flows/route.<ext>` — the same handler, forwarding `{ path: [] }`

`list_flows` is `GET /` on the mount base. A required catch-all cannot match zero segments, so the bare file exists. On Vercel, `createVercelNextHandler` from `@flow-state-dev/vercel/next` is the same shape with SSE shaping.

The mount imports the root config by relative path. There is no `lib/flowstate` re-export on this path — that file is not on the allowlist.

## Dependency set

A rule, not a list: every package a generated file imports directly is a direct dependency.

- `zod`
- the chosen `@ai-sdk/*`
- `@flow-state-dev/core`, `@flow-state-dev/engine`
- `@flow-state-dev/next` on a Next host
- `@flow-state-dev/fsdev` and `@flow-state-dev/devtool` as devDependencies

Proved by an isolated install, not a static scan. npm hoists transitives; pnpm does not.

## Authored-file marker

Each file written whole carries `// fsd:generated sha256:<digest of the body below>`. A rerun that finds a missing or stale marker leaves the file alone.
