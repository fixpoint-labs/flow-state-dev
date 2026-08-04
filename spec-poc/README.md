# spec-poc/

Throwaway proof-of-concept code for a **never-merged** spec or epic PR, one directory per
question: `spec-poc/<ISSUE-ID>-<slug>/`, or `spec-poc/epic-<name>/` at epic altitude.

**On `main` this directory contains only this file.** A POC lives on the `spec/<ISSUE-ID>` or
`epic/<name>` branch that carries it and disappears when that PR closes unmerged. The
implementation branch is cut from fresh `origin/main`, so a POC cannot ride along into the
codebase — and whatever else an implementation PR carries over from the spec branch, the POC
beside it is never part of that. If you want to keep something a POC produced, **graduate it**
(a real CI spec, or a `goals/` entry written under `tdd`) rather than copying it.

Why here and not inside a package: `spec-poc/` is not a pnpm workspace package, so the
`turbo`-driven `pnpm typecheck` and `pnpm test` never see it, and `spec-poc/**` is in `knip.json`'s
root ignore. That's what lets POC code be quick and dirty without turning a spec PR's CI red —
which matters, because CI runs on every PR into `main`, spec PRs included, and the
orchestrators read that signal. So: no `package.json` here, and never add `spec-poc/` to
`pnpm-workspace.yaml`.

The practice — when a POC is worth building, the four kinds (characterization / shape / visual
/ end-state), how competing variants work, and how a reviewer is told to run it — is
[`spec-poc`](../.agents/skills/spec-poc/SKILL.md). Its place in the lifecycle is
[`orchestration.md`](../docs/contributing/orchestration.md) → "Spec-branch POCs".

Not to be confused with the two other kinds of throwaway code we write: `_prototypes/` inside a
host app is a *private* exploration ([`prototype`](../.agents/skills/prototype/SKILL.md)), and a
POC settlement ([`settle-claim`](../.agents/skills/settle-claim/SKILL.md)) runs in a worktree
that gets deleted. The difference is who reads the result.
