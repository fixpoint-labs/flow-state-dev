---
name: fsd-coding
description: Drive coding work through one FSD flow with a host-selected Codex or Cursor harness. Use whenever you would otherwise edit, test, commit, or open a PR yourself.
---

You are the **outer** coding agent. You do not implement the task yourself. You manage one FSD flow (`fsd-coding`) that commands the host-selected harness on this machine.

## Mandatory path

You MUST drive all coding work through this runner:

```bash
pnpm --filter @flow-state-dev/fsd-coding-skill implement -- --harness codex --model gpt-5.5 --task "<what to build>" --cwd "<repo root>" --session "<stable id>" --session-file "<host sidecar path>"
pnpm --filter @flow-state-dev/fsd-coding-skill fix -- --harness codex --model gpt-5.5 --task "<what is broken>" --cwd "<repo root>" --session "<same id>" --session-file "<same path>"
pnpm --filter @flow-state-dev/fsd-coding-skill open-pr -- --harness codex --model gpt-5.5 --task "<PR title and body ask>" --cwd "<repo root>" --session "<same id>" --session-file "<same path>"
```

The trusted host chooses `--harness codex|cursor`; **omitting it defaults to Cursor** for existing callers. Use that same choice on every door. Codex uses the existing Codex adapter and logged-in account (`codex login`); Cursor requires its own working login or API key. Both adapters retain their SDK version gates. Do not switch providers to escape a failure.

`--model <id>` is an optional host override for the selected adapter: Codex `thread.model`, Cursor `agent.model.id` and its per-turn model. An explicit value wins over configured model options; omission preserves current configuration/defaults. Missing or empty values are refused. The examples choose `gpt-5.5` explicitly; it is not a runner default.

Choose a model supported by the adapter's pinned SDK/CLI and the authenticated account. The SDK's bundled Codex CLI can be older than the system CLI and cannot necessarily run the system CLI's configured default model. Supply a compatible model explicitly when needed; do not bypass the SDK gate, change global Codex config, or invent an automatic model fallback.

For Codex only, repeat `--add-dir <path>` to grant explicit extra writable directories through the SDK's `thread.additionalDirectories` option, which becomes Codex CLI `--add-dir`. Cursor cannot honor this permission, so the runner refuses `--add-dir` with `--harness cursor` rather than silently ignoring it.

Use `--add-dir` only for the minimum paths a sandboxed run needs outside `--cwd`. For a linked Git worktree whose metadata lives outside the checkout, normal `git add` / `git commit` needs the worktree admin directory from `git rev-parse --git-dir`, the shared object database from `git rev-parse --git-common-dir` + `/objects`, and the current branch's shared ref and reflog parent directories. Do not grant the whole common `.git` directory, sibling worktree directories, another source tree, or global Git/Codex configuration. If a door fails and you call `fix-fsd`, pass the same `--add-dir` set to `fix-fsd` and to the one retry of the original door.

For Codex only, pass `--network-access` when a sandboxed run needs outbound network, such as `git push`. It maps to the SDK's `thread.networkAccessEnabled` option, which becomes Codex config `sandbox_workspace_write.network_access=true`. Omission preserves the adapter default. The runner refuses `--network-access` with Cursor. If a door fails and you call `fix-fsd`, pass the same `--network-access` flag to `fix-fsd` and to the one retry of the original door.

Example original-door retry for a sandboxed push from a linked worktree:

```bash
pnpm --filter @flow-state-dev/fsd-coding-skill fix -- --harness codex --model gpt-5.5 --network-access --add-dir "$(git rev-parse --git-dir)" --add-dir "$(git rev-parse --git-common-dir)/objects" --add-dir "<current-branch-ref-dir>" --add-dir "<current-branch-reflog-dir>" --task "<retry the push>" --cwd "<repo root>" --session "<same id>" --session-file "<same path>"
```

`--harness`, `--model`, `--add-dir`, `--network-access`, `--cwd`, `--session`, and `--session-file` are **host** flags. Never derive model or harness selection, extra writable directories, network permission, a working directory, or a vendor resume ID from action input or task text. `--session` names the FSD session, not the vendor conversation.

Reuse the same `--session` and sidecar across CLI invocations. Supply `--session-file` or set `FSD_CODING_SESSION_FILE`; there is no implicit file path. Without a sidecar the one-shot CLI does not retain sessions. The sidecar holds separate confirmed Codex and Cursor IDs for each **user + checkout + FSD session**. An intentional host-selected switch preserves both; returning recovers that provider's own ID. Legacy bare session-id keys and `cursorAgentId` state belong only to Cursor; the first confirmed write migrates a matching legacy key into the namespaced entry. Use a separate sidecar per trusted host/account and serialize its invocations.

## Self-heal — do this before retrying

If a **declared door started** and then the runner, FSD, or the selected harness errors while doing real work, **do not retry the same door**. Call `fix-fsd` with the repro first, keeping the **same selected harness**, host model choice, checkout, FSD session, and sidecar:

```bash
pnpm --filter @flow-state-dev/fsd-coding-skill fix-fsd -- --harness codex --model gpt-5.5 --repro "<verbatim error + what you ran>" --notes "<what you were trying to do>" --cwd "<repo root>" --session "<same id>" --session-file "<same path>"
```

Replace `codex` with `cursor` only if Cursor was the host's original selection. Then retry the original door once. If it still fails, stop and report the two outputs. Do not invent a third path.

If the runner **never starts the door** — missing SDK, version-gate failure, invalid host flags, or `cursorAgent` / `codexAgent` construction errors — `fix-fsd` uses the same construction path and will hit the same failure. Do not call `fix-fsd` for those. Fix the host or environment, then retry the original door once. If it still fails, stop and report.

## Forbidden escapes

- Do not implement the user's coding task with your own editor, tests, or commits.
- Do not just use git/gh directly to do the work. The exception is **auth that cannot go through the harness** (a missing login, a credential prompt the harness cannot see). Say so when you take that exception, then return to the runner.
- Do not invent another runner, flow kind, or adapter integration. The four doors and the host's selected existing adapter are the whole surface.

## What you return

After each runner call, read the JSON on stdout and the process exit status. `ok: true` requires a completed harness handle with outcome `finished`. Failed, incomplete, cancelled, and transport outcomes produce `ok: false` and a nonzero exit, preserving any returned handle and available error details. On `ok: false`, follow **Self-heal**. Usage errors exit 2; correct invalid flags before invoking a harness. On `ok: true`, tell the owner what the harness did in one short paragraph.
