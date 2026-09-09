---
name: fsd-coding
description: Drive coding work through one FSD flow with a host-selected Codex or Cursor harness on a local machine or Grok box where that harness is already signed in. Use whenever you would otherwise edit, test, commit, or open a PR yourself on those hosts. Do not use on Cloud Agent VMs or nested cloud harnesses — do that work yourself.
---

You are the **outer** coding agent. You do not implement the task yourself. You manage one FSD flow (`fsd-coding`) that commands the host-selected harness on this machine.

## Runtime (v1)

This path runs on a **local machine or Grok box** where the selected harness is already signed in (`codex login`, or Cursor `CURSOR_API_KEY` / SDK login).

**Out of scope:** cloud agent VMs and nested cloud harnesses. If you are on a Cloud Agent VM, this skill does not apply — implement the task yourself. Do not try to sign a harness in from a Cloud Agent VM, and do not wrap this skill around another cloud coding agent.

## Mandatory path

Drive all coding work through `fsdev run`. Config search is cwd-only — run from the lab:

```bash
cd labs/fsd-coding-skill

export FSD_CODING_CWD="$(git rev-parse --show-toplevel)"
# Omit FSD_CODING_HARNESS to default to Cursor.
export FSD_CODING_HARNESS=codex
export FSD_CODING_MODEL=gpt-5.5

pnpm fsdev run fsd-coding implement -i '{"task":"<what to build>"}' --session "<stable id>"
pnpm fsdev run fsd-coding fix       -i '{"task":"<what is broken>"}' --session "<same id>"
pnpm fsdev run fsd-coding openPr    -i '{"task":"<PR title and body ask>"}' --session "<same id>"
```

The trusted host chooses `FSD_CODING_HARNESS=codex|cursor`; **omitting it defaults to Cursor**. Use that same choice on every door. Do not switch providers to escape a failure.

`FSD_CODING_CWD` is required. It is the checkout the harness works in — never the lab directory by accident.

`--session` names the FSD session, not the vendor conversation. Reuse the same id so filesystemStores keep the confirmed Codex / Cursor ids `onSession` wrote. Do not invent a JSON sidecar or a second runner.

`FSD_CODING_HARNESS`, `FSD_CODING_CWD`, `FSD_CODING_MODEL`, `FSD_CODING_ADD_DIR`, and `FSD_CODING_NETWORK_ACCESS` are **host** flags. Never derive model or harness selection, extra writable directories, network permission, a working directory, or a vendor resume ID from action input or task text. Action input is only `{ "task": "..." }` or `{ "repro": "...", "notes": "..." }`.

`FSD_CODING_MODEL` is an optional host override for the selected adapter. Omission preserves adapter defaults. Empty values are refused. Choose a model the adapter's pinned SDK/CLI and the signed-in account actually run. Do not bypass an SDK gate or invent an automatic model fallback.

### Codex-only host permissions

For Codex only, set `FSD_CODING_ADD_DIR` to extra writable directories (`thread.additionalDirectories`), separated with the platform PATH delimiter (`:` on Unix / Grok, `;` on Windows). For a linked Git worktree whose metadata lives outside the checkout, grant the worktree admin directory from `git rev-parse --git-dir`, the shared object database from `git rev-parse --git-common-dir` + `/objects`, and the current branch's shared ref and reflog parent directories. Do not grant the whole common `.git` directory, sibling worktrees, another source tree, or global Git/Codex configuration.

For Codex only, set `FSD_CODING_NETWORK_ACCESS=1` when a sandboxed run needs outbound network, such as `git push`. Cursor cannot honor either permission; the host refuses those variables when the selected harness is Cursor. If a door fails and you call `fixFsd`, pass the same host flags to `fixFsd` and to the one retry of the original door.

## Self-heal — do this before retrying

If a **declared door started** and then FSD or the selected harness errors while doing real work, **do not retry the same door**. Call `fixFsd` with the repro first, keeping the **same selected harness**, host model choice, checkout, and `--session`:

```bash
pnpm fsdev run fsd-coding fixFsd \
  -i '{"repro":"<verbatim error + what you ran>","notes":"<what you were trying to do>"}' \
  --session "<same id>"
```

Then retry the original door once. If it still fails, stop and report the two outputs. Do not invent a third path.

If the runner **never starts the door** — missing SDK, version-gate failure, invalid host flags, or `cursorAgent` / `codexAgent` construction errors — `fixFsd` uses the same construction path and will hit the same failure. Do not call `fixFsd` for those. Fix the host or environment, then retry the original door once. If it still fails, stop and report.

## Forbidden escapes

These apply on a local machine or Grok box, where this skill is the path. On a Cloud Agent VM they do not — that host is out of v1.

- Do not implement the user's coding task with your own editor, tests, or commits.
- Do not just use git/gh directly to do the work. The exception is **auth that cannot go through the harness** (a missing login, a credential prompt the harness cannot see). Say so when you take that exception, then return to `fsdev run`.
- Do not invent another runner, flow kind, sidecar file, or adapter integration. The four doors, `fsdev run`, and the host's selected existing adapter are the whole surface.
- Do not nest this under Conductor. Do not invent flow-instance addressing (FIX-1320).

## What you return

After each `fsdev run`, read the NDJSON on stdout (or `--capture`) and the process exit status.

`outcome: "finished"` only means the vendor turn ended. It is not success by itself.

Treat the door as success only when the requested artifact is actually there:

- **implement / fix** — the asked change is in the checkout (the files, the named fix, or the tests that were supposed to go green). A finished turn that says it could not edit, or that leaves those tests red, is failure.
- **openPr** — an open PR exists. Prefer a URL on the stream or handle; otherwise confirm with `gh pr view` (or the host's equivalent). A finished turn that did not open or update the PR is failure.
- **fixFsd** — the repro is addressed enough to retry the original door.

Failed, incomplete, cancelled, and transport outcomes are failure. A finished turn whose artifact is missing is also failure — follow **Self-heal**. Do not skip `fixFsd` because the handle said `finished`.

On success, tell the owner what the harness did and where the artifact is (the PR URL for `openPr`) in one short paragraph.
