# @flow-state-dev/codex

Run OpenAI's Codex agent as a flow-state-dev block. Hand it a prompt, point it at
a directory, get back the framework's neutral harness handle — the same shape
`@flow-state-dev/claude-code` returns, so a caller that reads the handle can
drive either.

Full guide: [Codex SDK agent](https://flow-state.dev/docs/tools/codex).

## Install

```bash
pnpm add @flow-state-dev/codex @openai/codex-sdk@0.152.1
```

The SDK is an **exact-pinned optional peer**, and the pin is enforced: building a
block against any other installed version throws, naming both versions. Codex's
JSONL output sits behind an experimental flag and can change in a lockstep CLI and
SDK release, so every Codex upgrade is a tested release of this package rather
than something a host can take on its own. There is no override option.

At runtime Codex needs `CODEX_API_KEY` or a logged-in account, and expects a git
repository unless `skipGitRepoCheck` says otherwise.

## Use

```ts
import { codexAgent } from "@flow-state-dev/codex";

const agent = codexAgent({
  cwd: (_input, ctx) => workspacePathFor(ctx),          // where the run works
  resume: (_input, ctx) => storedThreadId(ctx),         // which thread to continue
  onSession: (id, ctx) => storeThreadId(id, ctx),       // called the moment one is named
  thread: { model: "gpt-5.4-codex", sandboxMode: "workspace-write", approvalPolicy: "never" },
  client: { apiKey: process.env.CODEX_API_KEY },
});
```

`createCodexAgentCapability(options)` takes the same options and exposes the block
to a generator as a tool.

**The block's input is the prompt and nothing else.** Where a run writes and which
conversation it continues are configuration, because the same block can be handed
to a model as a tool — a field on the input is a field the model could set.

**`onSession` is the write side of `resume`.** It is called with the thread id the
moment the run names one, before the run does any work. A cancelled or crashed run
returns no handle, so this is the only carrier that reaches your state in the case
resuming exists for. It fires only when Codex actually names a thread, so a resume
Codex refuses leaves the id you already hold untouched.

## Option groups

`thread` and `client` are the SDK's own option bags, forwarded verbatim and typed
locally so the optional peer is never imported for its types. Two keys are refused
when the block is built rather than forwarded, because each has exactly one owner:
a `workingDirectory` (the `cwd` resolver owns it) and a `signal` (the block's own
`ctx.signal` owns it).

Note that `client.env` **replaces** the CLI process's environment rather than
adding to it — the SDK's rule. Spread `process.env` to add.

## The handle

The neutral harness handle — `source: "codex/sdk"`, `status`, `sessionId`, `url`,
`dispatchedAt`, `outcome`, `finalMessage`, `usage`, `cost` — plus two fields only
Codex can fill: `codexUsage` (the full token breakdown, including cached input and
reasoning output) and `failureMessage`.

`outcome` is `"finished"` or `"failed"`. Codex reports no turn or budget cap, so
`"stopped-at-limit"` never appears here, and a run stopped by your deadline throws
rather than returning a handle.

## Cost

An estimate, always: Codex reports tokens and no price, so the number comes from
core's model price table and `cost.basis` reads `"estimated"`. It is `null` — never
`0` — when no model was configured (Codex's output never names the model that ran),
when the table has no entry for it, or when the turn reported no usage.

## Tests

```bash
pnpm --filter @flow-state-dev/codex test
pnpm exec turbo run typecheck --filter=@flow-state-dev/codex --force
```

Most specs script the Codex client through the `resolveCodexClient` seam and spawn
nothing. `test/installed-sdk.spec.ts` is the exception: it drives the **installed**
SDK against a fake `codex` binary that speaks the JSONL wire, with no API key and
no network. That spec is what makes the version pin mean something — it is what
goes red when a Codex bump changes the wire.

The real-model check lives outside CI, in
`goals/codex-harness/dispatches-and-resumes-through-the-contract/`.
