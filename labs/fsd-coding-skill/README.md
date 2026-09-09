# FSD coding skill

This private lab runs coding tasks through one FSD flow and a host-selected
Codex or Cursor harness. Drive it with `fsdev run`. There is no private
runner and no extra session file — `--session` plus the filesystem store is
the resume path.

**v1 runtime is a local machine or Grok box** where the selected harness is
already signed in. Cloud agent VMs and nested cloud harnesses are out of
scope.

## Run

From this directory (`fsdev` config search is cwd-only):

```bash
export FSD_CODING_CWD="$(git rev-parse --show-toplevel)"
# Optional. Omit defaults to Cursor.
export FSD_CODING_HARNESS=codex
# Optional host model override for the selected adapter.
export FSD_CODING_MODEL=gpt-5.5

pnpm fsdev run fsd-coding implement -i '{"task":"<what to build>"}' --session work-1
pnpm fsdev run fsd-coding fix       -i '{"task":"<what is broken>"}' --session work-1
pnpm fsdev run fsd-coding openPr    -i '{"task":"<PR title and body ask>"}' --session work-1
```

`FSD_CODING_HARNESS` is `codex` or `cursor`. **Omitting it defaults to Cursor.**
Use the same choice on every door. Codex uses the logged-in account
(`codex login`); Cursor needs its own working login or API key. Both adapters
keep their SDK version gates.

`FSD_CODING_CWD` is required. It is the checkout the harness works in. There
is no safe default — this process's directory is the lab, not the repo.

`--session` is the FSD session, not a vendor conversation id. Reuse it across
invocations so `onSession` ids survive in `.fsdev/data`.

Action input is only `{ task }` or `{ repro, notes? }`. Task text cannot choose
the adapter, model, working directory, or resume id.

### Codex-only host permissions

```bash
export FSD_CODING_NETWORK_ACCESS=1
export FSD_CODING_ADD_DIR="$(git rev-parse --git-dir):$(git rev-parse --git-common-dir)/objects"
```

`FSD_CODING_NETWORK_ACCESS` maps to Codex `thread.networkAccessEnabled` (needed
for a sandboxed `git push`). `FSD_CODING_ADD_DIR` is colon-separated extra
writable roots (`thread.additionalDirectories`). Cursor cannot honor either;
the host refuses them when the selected harness is Cursor.

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

Keep the same host flags and `--session`. Then retry the original door once.
Report both outputs if it fails again.

## Lab internals

There is no package barrel. Tests and `fsdev.config.ts` import source files
directly:

- `src/flow.ts` — `createFsdCodingFlow`: host cwd / resume / onSession feeds
  plus one `fsd-coding` singleton with `implement`, `fix`, `openPr`, `fixFsd`
- `src/config-env.ts` — reading `FSD_CODING_*` for the config
- `src/schemas.ts` — door names, prompt prefixes, input/state contracts

`fsdev.config.ts` builds the flow from those host env vars and stores
sessions under `.fsdev/data`.

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
