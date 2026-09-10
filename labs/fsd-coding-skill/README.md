# FSD coding skill

This private lab runs coding tasks through one FSD flow and a host-selected
Codex, Cursor, or Claude harness. Drive it with `fsdev run`. There is no
private runner and no extra session file — `--session` plus the filesystem
store is the resume path.

**v1 runtime is a local machine or Grok box** where the selected harness is
already signed in. Cloud agent VMs and nested cloud harnesses are out of
scope.

## Run

From this directory (`fsdev` config search is cwd-only), pass the host values
on each command; no shell exports are required:

```bash
env -u FSD_CODING_MODEL \
  FSD_CODING_HARNESS=codex \
  FSD_CODING_CWD=/absolute/path/to/target-checkout \
  FSD_CODING_NETWORK_ACCESS=0 FSD_CODING_ADD_DIR= \
  pnpm fsdev run fsd-coding implement -i '{"task":"<what to build>"}' --session work-1
```

Command tools with `cwd` and `env` fields can pass these values directly.
Resolve the target checkout from the outer session before running from this
lab; it may be a different repository or linked worktree. The lab's process
directory is not a safe target default. `FSD_CODING_CWD` must reach the child
process, but need not exist in the parent shell.

The outer agent resolves the harness, checkout, model, and permissions from
owner choices and trusted session context, following
[the skill's resolution rules](../../.agents/skills/fsd-coding/SKILL.md#resolve-host-values-from-this-session).

`FSD_CODING_HARNESS` accepts `codex`, `cursor`, or `claude`. Codex uses
`codex login`; Cursor needs its own working login or API key; Claude needs
signed-in Claude Code / Anthropic credentials. OMP is an outer harness, not
one of these target adapters. Codex and Cursor keep their SDK version gates.
Claude uses `@flow-state-dev/claude-code/sdk` (`claudeCodeAgent`), with the
optional peer `@anthropic-ai/claude-agent-sdk`.

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

```bash
pnpm fsdev run fsd-coding fixFsd \
  -i '{"repro":"<verbatim error and command>","notes":"<intent>"}' \
  --session work-1
```
The snippet shows only the command; reuse the original tool `cwd` and `env`.

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

Tests inject scripted clients through each adapter's existing client seam.
A live door needs a signed-in harness for the host's selection.

The outer agent's mandatory path is
[the fsd-coding skill](../../.agents/skills/fsd-coding/SKILL.md).
No changeset needed: this is a private lab.
