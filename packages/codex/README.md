# @flow-state-dev/codex

Run OpenAI's Codex agent as a flow-state-dev block. Hand it a prompt, point it at
a directory, get back the framework's neutral harness handle. It is the same shape
`@flow-state-dev/claude-code` returns, so a caller that reads the handle can
drive either.

[`@flow-state-dev/claude-code`](../claude-code) is the other harness, and
[`@flow-state-dev/harness-manager`](../harness-manager) drives either from a task
board without knowing which one it has.

Full guide: [Codex SDK agent](https://flow-state.dev/docs/tools/codex). The
contract both harnesses implement is
[Coding agents](https://flow-state.dev/docs/tools/coding-agents).

## Install

```bash
pnpm add @flow-state-dev/codex @openai/codex-sdk@0.164.0
```

The SDK is an **exact-pinned optional peer**, and the pin is enforced: building a
block against any other installed version throws, naming both versions. Codex's
JSONL output sits behind an experimental flag and can change in a lockstep CLI and
SDK release, so every Codex upgrade is a tested release of this package. There is
no override option.

An SDK that is present but whose version cannot be determined (Yarn PnP, a custom
loader) is refused too.

At runtime Codex needs `CODEX_API_KEY` or a logged-in account, and expects a git
repository unless `skipGitRepoCheck` says otherwise.

## Use

```ts
import { codexAgent } from "@flow-state-dev/codex";

const agent = codexAgent({
  cwd: (ctx) => workspacePathFor(ctx),          // where the run works
  resume: (ctx) => storedThreadId(ctx),         // which thread to continue
  onSession: (id, ctx) => storeThreadId(id, ctx),       // called the moment one is named
  model: (ctx) => storedModel(ctx),                     // which model, per run (or a fixed id)
  thread: { sandboxMode: "workspace-write", approvalPolicy: "never" },
  client: { apiKey: process.env.CODEX_API_KEY },
});
```

`createCodexAgentCapability(options)` takes the same options and exposes the block
to a generator as a tool.

**`model` is asked once per run.** One block can run a different model per
session, and a resumed thread is handed it too. `null` leaves Codex on its default.
`thread.model` still takes a fixed id; setting both is refused when the block is
built. Codex's SDK can't list models, so the ids are yours to supply.

**The block's input is the prompt and nothing else.** Where a run writes, which
conversation it continues and which model it runs are configuration, because the same block can be handed
to a model as a tool, and a field on the input is a field the model could set. The
resolvers are handed the block context alone and never the prompt, so a path or a
session id cannot be derived from text the model wrote.

**`onSession` is the write side of `resume`.** It is called with the thread id the
moment the run names one, before the run does any work. A cancelled or crashed run
returns no handle, so this is the only carrier that reaches your state in the case
resuming exists for. It fires only when Codex actually names a thread, so a resume
Codex refuses leaves the id you already hold untouched. The run then fails with a
`CodexAgentRunError`. `harnessFailureKind(error)` from `@flow-state-dev/core` returns
`"unknown-conversation"` for it, and `null` for every other failure.

## Option groups

`thread` and `client` are the SDK's own option bags, forwarded verbatim. Two keys
are refused when the block is built: `workingDirectory` (the `cwd` resolver sets
it) and `signal` (the block's own `ctx.signal` sets it).

Leave `client.env` unset and the Codex CLI process inherits your server's entire
`process.env`, secrets included. Setting it **replaces** that environment rather
than adding to it (the SDK's rule), so `client: { env: harnessEnv({ pass: [...] }) }`,
with `harnessEnv` from `@flow-state-dev/core`, passes only the variables you name.

## The handle

The neutral harness handle (`source: "codex/sdk"`, `status`, `sessionId`, `url`,
`dispatchedAt`, `outcome`, `finalMessage`, `usage`, `cost`), plus two fields only
Codex can fill: `codexUsage` (the full token breakdown, including cached input and
reasoning output) and `failureMessage`.

`outcome` is `"finished"` or `"failed"`. Codex reports no turn or budget cap, so
`"stopped-at-limit"` never appears here, and a run stopped by your deadline throws
rather than returning a handle.

## Warnings and failures

Codex's own warnings, such as a configured service tier the model doesn't
support, are kept `status` notes, not `error` items: nothing about them ends the
run. The stream's own errors (its reconnect attempts) are the transient status;
the last one becomes the failure when no turn result follows it. A run that fails emits one
`error` item whose `message` is one line saying why, read out of the API's error
body when Codex passes one through; everything the Codex CLI printed on its way
out is on that item's `details.output`, and no closing status repeats the line.

A turn Codex reports as failed returns an `errored` handle with `outcome:
"failed"`, also when the CLI then exits non-zero. The block throws only when
the run ends without a turn result: the CLI exiting first, a refused thread, or
a stop.

## Cost

An estimate, always: Codex reports tokens and no price, so the number comes from
core's model price table and `cost.basis` reads `"estimated"`. It is `null`, never
`0`, when no model was named (Codex's output never names the model that ran),
when the table has no entry for it, or when the turn reported no usage.

## Reading usage left

`readCodexUsage({ env, timeoutMs?, signal? })` asks Codex how much of each
subscription window is used, with no run, and returns core's
`HarnessUsageReading`. It starts the Codex CLI the SDK brings as `codex
app-server`, asks it, and stops it. Pass the `env` your runs get, so both see
one sign-in:

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { readCodexUsage } from "@flow-state-dev/codex";

const reading = await readCodexUsage({ env: harnessEnv({ pass: ["PATH", "HOME", "CODEX_HOME"] }) });
// { status: "windows", plan, accountId, windows: [{ id: "codex:primary", minutes: 300, usedPercent, resetsAt, label }] }
```

It never throws. A ChatGPT sign-in reads `windows`, every window Codex reports.
An API key reads `api-key`, nobody signed in reads `signed-out`, and a CLI that
can't be found, stops, or doesn't answer within `timeoutMs` (default 10 000 ms)
reads `unavailable`. Each of those three carries a plain `reason` and no number.
An aborted `signal` reads `unavailable`.

`findCodexProgram(env)` returns the program the SDK would start (`{ path,
pathDirs }`), and throws when the SDK can't be loaded.

**Local only.** OpenAI permits the app-server's ChatGPT sign-in on your own
machine, not in a hosted service. A host opts in by passing `readCodexUsage` as
its Codex usage reader, for example to `harnessUsageAction` in
`@flow-state-dev/harness-manager`.

## Tests

```bash
pnpm --filter @flow-state-dev/codex test
pnpm exec turbo run typecheck --filter=@flow-state-dev/codex --force
```

Most specs script the Codex client through the `resolveCodexClient` seam and spawn
nothing. `test/installed-sdk.spec.ts` is the exception: it drives the **installed**
SDK against a fake `codex` binary that speaks the JSONL wire, with no API key and
no network. That spec is what makes the version pin mean something: it is what
goes red when a Codex bump changes the wire.

The real-model check lives outside CI, in
`goals/codex-harness/dispatches-and-resumes-through-the-contract/`.
