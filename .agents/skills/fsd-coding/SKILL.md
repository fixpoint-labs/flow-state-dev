---
name: fsd-coding
description: Drive coding work by managing one FSD coding flow that commands a signed-in Cursor harness. Use whenever you would otherwise edit, test, commit, or open a PR yourself.
---

You are the **outer** coding agent. You do not implement the task yourself. You manage one FSD flow (`fsd-coding`) that commands a Cursor harness on this machine. This is dogfood of FSD plus that harness.

## Mandatory path

You MUST drive all coding work through this runner:

```bash
pnpm --filter @flow-state-dev/fsd-coding-skill implement -- --task "<what to build>" --cwd "<repo root>" --session "<stable id>"
pnpm --filter @flow-state-dev/fsd-coding-skill fix -- --task "<what is broken>" --cwd "<repo root>" --session "<same id>"
pnpm --filter @flow-state-dev/fsd-coding-skill open-pr -- --task "<PR title and body ask>" --cwd "<repo root>" --session "<same id>"
```

`--cwd` and `--session` are **host** flags. Never put a working directory or a Cursor session id on the task text and expect the flow to honor them.

Reuse `--session` so `fix` and `open-pr` continue the same Cursor agent. Default session file: set `FSD_CODING_SESSION_FILE` or pass `--session-file`.

Live runs need a signed-in Cursor harness (`CURSOR_API_KEY` or the SDK's own login). This skill is for a machine where that is already true.

## Self-heal — do this before retrying

If the runner, FSD, or the Cursor harness errors while doing real work, **do not retry the same door**. Call `fix-fsd` with the repro first:

```bash
pnpm --filter @flow-state-dev/fsd-coding-skill fix-fsd -- --repro "<verbatim error + what you ran>" --notes "<what you were trying to do>" --cwd "<repo root>" --session "<same id>"
```

Then retry the original door once. If it still fails, stop and report the two outputs. Do not invent a third path.

## Forbidden escapes

- Do not implement the user's coding task with your own editor, tests, or commits.
- Do not just use git/gh directly to do the work. The exception is **auth that cannot go through the harness** (a missing login, a credential prompt the harness cannot see). Say so when you take that exception, then return to the runner.
- Do not invent a second runner, a second flow kind, or a second harness. The four doors and this Cursor harness are the whole surface.

## What you return

After each runner call, read the JSON on stdout. On `ok: false`, follow **Self-heal**. On `ok: true`, tell the owner what the harness did in one short paragraph — not a transcript of the flow internals.
