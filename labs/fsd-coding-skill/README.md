# FSD coding skill

This private lab runs coding tasks through one FSD flow and a host-selected
Codex, Cursor, or Claude harness. Drive it with `fsdev run`. There is no
private runner and no extra session file — `--session` plus the filesystem
store is the resume path.

**v1 runtime is a local machine or Grok box** where the selected harness is
already signed in. Cloud agent VMs and nested cloud harnesses are out of
scope.

## Run

All four doors run through a **supervised live stream**. From this directory
(`fsdev` config search is cwd-only), follow the canonical
[launch instructions](../../.agents/skills/fsd-coding/SKILL.md#pass-values-on-each-invocation)
for the managed process, host environment, and `bash -o pipefail` pipeline with
`tee` and `jq --unbuffered`.

`progress.jq` projects bounded live events while `tee` retains the raw NDJSON
locally; `--capture` is completion-only. Follow the skill's
[progress and evidence rules](../../.agents/skills/fsd-coding/SKILL.md#follow-progress-without-filling-the-context)
for incremental log reads, permission failures, and artifact verification.

Resolve the target checkout before running from this lab; it may be a different
repository or linked worktree. The lab directory is not a safe target default.

The outer agent resolves the harness, checkout, model, and permissions from
owner choices and trusted session context, following
[the skill's resolution rules](../../.agents/skills/fsd-coding/SKILL.md#resolve-host-values-from-this-session).

`FSD_CODING_HARNESS` accepts `codex`, `cursor`, or `claude`. Codex uses
`codex login`; Cursor needs its own working login or API key; Claude needs
signed-in Claude Code / Anthropic credentials. OMP is an outer harness, not
one of these target adapters. Codex and Cursor keep their SDK version gates.
Claude uses `@flow-state-dev/claude-code/sdk` (`claudeCodeAgent`), with the
optional peer `@anthropic-ai/claude-agent-sdk`.
Follow the skill's
[Claude permission policy](../../.agents/skills/fsd-coding/SKILL.md#claude-permission-policy)
for operation. Trusted programmatic callers of `createFsdCodingFlow` may use
`options.claude` to **replace** `disallowedTools` or `sandbox` and choose
`permissionMode`; the factory owns `cwd`, `detached`, and `name`. These are
programmatic configuration options, not an `FSD_CODING_*` environment escape.

For a model override, add `FSD_CODING_MODEL=<supported-target-model-id>`.

`--session` is the FSD session, not a vendor conversation id. Reuse it with
the same lab directory: that lab's `.fsdev/data` holds the resume state.

Action input is only `{ task }` or `{ repro, notes? }`. Task text cannot choose
the adapter, model, working directory, or resume id.

### Codex-only host permissions

Pass these through the same command-local environment when authorized:

- `FSD_CODING_NETWORK_ACCESS=1` for outbound network.
- `FSD_CODING_ADD_DIR=<extra-root>:<other-root>` for extra writable roots.

`FSD_CODING_NETWORK_ACCESS` maps to Codex `thread.networkAccessEnabled` (needed
for a sandboxed `git push`). `FSD_CODING_ADD_DIR` is PATH-style extra writable
roots (`thread.additionalDirectories`), split on `path.delimiter` (`:` on
Unix / Grok, `;` on Windows). Limit linked-worktree grants as described in
[the skill](../../.agents/skills/fsd-coding/SKILL.md#codex-only-host-permissions).
Cursor and Claude cannot honor either enabled permission.

A door whose harness handle says `outcome: finished` is not done until the
asked artifact is there — especially `openPr` (an open PR / URL). A finished
turn that did not produce the artifact is a failure; call `fixFsd` before
retrying.

### Self-heal

`fixFsd` is only for failures after a declared door started. Bootstrap
failures — missing SDK, version-gate, invalid host flags, or adapter
construction — use the same construction path, so `fixFsd` cannot recover
them. Fix the host or environment, then retry the original door once.

Use the same supervised streaming command with `FSD_DOOR=fixFsd` and
`FSD_INPUT='{"repro":"<verbatim error and command>","notes":"<intent>"}'`.
Choose new raw-trace and capture paths, preserving the original host settings.

Keep the same host flags and `--session`. Then retry the original door once.
Report both outputs if it fails again.

## Lab internals

There is no package barrel. Tests and `fsdev.config.ts` import source files
directly:

- `src/flow.ts` — `createFsdCodingFlow`: host cwd / resume / onSession feeds
  plus one `fsd-coding` singleton with `implement`, `fix`, `openPr`, `fixFsd`
- `src/config-env.ts` — reading `FSD_CODING_*` for the config
- `src/schemas.ts` — door names, prompt prefixes, input/state contracts

`fsdev.config.ts` builds the flow from the child process's host environment
and stores sessions under `.fsdev/data`. No new runner or config file is needed.

## Verification

```bash
pnpm --filter @flow-state-dev/fsd-coding-skill test
pnpm --filter @flow-state-dev/fsd-coding-skill typecheck
```

Adapter tests inject scripted clients through each adapter's existing seam.
The focused `test/progress.spec.ts` exercises the real `jq` subprocess, including
emission before stdin closes; it needs `jq` on `PATH`, not provider credentials.
A live coding door needs a signed-in harness for the selected host.

The outer agent's mandatory path is
[the fsd-coding skill](../../.agents/skills/fsd-coding/SKILL.md).
No changeset needed: this is a private lab.
