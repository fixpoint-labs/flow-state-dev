# FSD coding skill — POC

This private lab runs coding tasks through one FSD flow and a host-selected
Codex or Cursor harness. It reuses `@flow-state-dev/codex` and
`@flow-state-dev/cursor`. Do not merge this as product API.

## Run

```bash
pnpm --filter @flow-state-dev/fsd-coding-skill implement -- --harness codex --model gpt-5.5 --task "<task>" --cwd "$PWD" --session work-1 --session-file /tmp/fsd-coding-sessions.json
pnpm --filter @flow-state-dev/fsd-coding-skill fix -- --harness codex --model gpt-5.5 --task "<correction>" --cwd "$PWD" --session work-1 --session-file /tmp/fsd-coding-sessions.json
pnpm --filter @flow-state-dev/fsd-coding-skill open-pr -- --harness codex --model gpt-5.5 --task "<PR request>" --cwd "$PWD" --session work-1 --session-file /tmp/fsd-coding-sessions.json
```

`--harness codex|cursor` selects the adapter for all four doors. **Cursor is
the default** for existing callers. Invalid names are refused. Codex uses the
logged-in account; no API key is required when already
logged in with `codex login`. The adapter's exact SDK version gate remains active.
Cursor requires its own working login or API key; choosing Codex never starts Cursor.

`--model <id>` overrides the selected adapter's configured model on every door:
Codex `thread.model`, Cursor `agent.model.id` and the per-turn model. Omission
preserves existing configuration/defaults. Missing, empty, or whitespace-only
values are rejected. Other adapter options are preserved.

`--add-dir <path>` may be repeated with `--harness codex` to pass Codex's
supported `thread.additionalDirectories` option, which the SDK forwards to the
Codex CLI as `--add-dir`. Use it for explicit extra writable roots such as a
linked worktree's Git metadata. Cursor cannot honor this permission and the CLI
rejects `--add-dir` when `--harness cursor` is selected.

Examples choose `gpt-5.5` explicitly; it is not a runner default. The host must
choose a model supported by the authenticated account and the adapter's pinned
SDK/CLI. The SDK's bundled Codex CLI may be older than the system CLI, so an
inherited default model can require a newer CLI. An explicit compatible model
avoids changing global configuration. There is no automatic model fallback,
SDK upgrade, or version-gate bypass.

The fourth door handles runner failures:

```bash
pnpm --filter @flow-state-dev/fsd-coding-skill fix-fsd -- --harness codex --model gpt-5.5 --repro "<verbatim error and command>" --notes "<intent>" --cwd "$PWD" --session work-1 --session-file /tmp/fsd-coding-sessions.json
```

Use the **same selected harness**, host model choice, checkout, FSD session and sidecar for
`fix-fsd`, then retry the original door once. Report both outputs if it fails
again. The runner does not add a model retry loop.

## Host configuration and persistence

`--cwd` (or `FSD_CODING_CWD`, then the process cwd), `--harness`, `--model`, `--session`
(default `fsd-coding`), and `--session-file` are host flags. Action input is
only `{ task }` or `{ repro, notes? }`; task text cannot choose the adapter, model,
working directory, or resume ID. `--session` is an FSD session ID, not a vendor ID.

For separate CLI invocations, supply `--session-file` or set
`FSD_CODING_SESSION_FILE`. There is no implicit file path. Without a sidecar,
continuity requires the same in-memory stores, which the one-shot CLI does not retain.

The host stores confirmed IDs in session state as
`harnessSessions: { cursor?: string, codex?: string }`. State takes precedence;
the sidecar is its cross-process fallback, keyed by FSD session ID:

```json
{ "work-1": { "cursor": "cursor-agent-id", "codex": "codex-thread-id" } }
```

Switching providers preserves both entries; switching back resumes that provider's
own session. Legacy `cursorAgentId` state and legacy sidecar string entries are
read as Cursor-only. A write upgrades the touched sidecar entry while preserving
its Cursor ID and other sessions. Only the adapter's `onSession` confirmation
writes IDs; a requested resume alone does not confirm anything. Legacy forms are
compatibility reads for this POC, not fields new callers should write.

This sidecar is a single trusted host's sequential-run file. It provides no
cross-process locking or multi-user isolation; use separate files for independent
hosts/accounts. FSD stores remain responsible for in-process session ownership.

## API surface

The private package root exports:

- `createFsdCodingFlow(FsdCodingHostOptions)`: one `fsd-coding` flow with
  `implement`, `fix`, `openPr`, `fixFsd`. Options add optional `harness`, `model`, and
  `additionalDirectories`, plus `codex: CodexAgentOptions`; Codex's `thread`, `client`, and
  `resolveCodexClient` use the existing adapter contracts. Existing `cursor`,
  `agent`, and `resolveCursorClient` options remain supported. Host
  `cwd`/`resume`/`onSession` feeds override adapter-bag feeds. Explicit `model`
  overrides the selected adapter's model options; explicit `additionalDirectories`
  overrides Codex's configured `thread.additionalDirectories`; omission preserves them.
- `createHostResolvers(HostResolverOptions)`: host cwd, provider-safe resume,
  and confirmed-session persistence. `harness` defaults to Cursor.
- `parseArgs`, `runCli`, `CliUsageError`, `ParsedCli`, `RunCliOptions`: CLI
  parsing and one action execution. `runCli` returns the engine result, stores,
  door, and declared doors; `run.ts` formats the skill-facing result. `ParsedCli`
  and `RunCliOptions` carry optional host `model` and `additionalDirectories`
  alongside `harness`.
- `DOORS`, `DOOR_PREFIX`, `FLOW_KIND`, `CodingDoor`, `taskInputSchema`,
  `fixFsdInputSchema`, `sessionStateSchema`, `TaskInput`, `FixFsdInput`:
  the static door names, prompt prefixes, and input/state contracts.

The executable prints JSON on stdout. `ok: true` requires a completed handle
with outcome `finished`. Failed, incomplete, limited, cancelled, and transport
outcomes produce `ok: false` and exit code 1, preserving a returned handle and
available error details. Usage errors exit 2. `open-pr` is a prompt prefix,
not a git/gh integration.

## Verification

```bash
pnpm --filter @flow-state-dev/fsd-coding-skill test
pnpm --filter @flow-state-dev/fsd-coding-skill typecheck
```

Tests inject scripted clients through each adapter's existing client seam.
Cursor tests retain the internal version-reader seam; production uses the real
gates. Provider-switching tests cover shared stores, fresh stores with a sidecar,
legacy records, and unconfirmed resume requests. CLI tests cover the four doors,
host authority, model precedence/defaults, and failure exit reporting. Real Codex
resume requires two host-run no-tools/no-edits token-response invocations using
the same harness, compatible model, session and sidecar.

The outer agent's mandatory path is documented in
[the fsd-coding skill](../../.agents/skills/fsd-coding/SKILL.md).
No changeset needed: this is a private lab.
