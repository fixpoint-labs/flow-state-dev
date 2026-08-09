# `spec/` — the in-flight spec, and nothing else

This folder holds **one spec at a time, on a spec branch, and never on `main`.**

`issue-spec` writes `spec/<ISSUE-ID>.md` here on branch `spec/<ISSUE-ID>`, opens the spec PR
for review, and that copy dies with the PR. CI blocks any other PR that carries a file here,
so a spec cannot reach `main` by accident or by a well-meaning "land the approved spec"
commit.

## Where specs actually live

**Linear.** The issue's attached document is the spec, and it is the only durable copy. The
repo deliberately keeps none — a spec is a point-in-time plan, and a folder full of them is a
corpus that decays without anyone noticing.

Looking for the spec for a shipped change? Find its Linear issue. Every changeset names the
issue it came from, so a release note traces back to the reasoning behind it.

## What the repo keeps instead

A spec's durable content is already carried by surfaces that get updated with the code:

| What | Where |
|---|---|
| What the thing does, for users | `apps/docs` (Docusaurus) and `packages/*/README.md` |
| How the system is shaped, and why | `docs/architecture/*` |
| What changed in a release, and which issue it came from | `.changeset/*.md` → `CHANGELOG.md` |
| Why a specific line is the way it is | a comment at that line — stating the reason, not linking to one |

That last row is the rule that keeps this working: **a code comment must state its reason, not
cite a document.** A pointer to a spec path rots the moment the spec closes, and CI rejects
one.

## Conventions

- One spec per spec branch. Parallel issues run on their own branches and worktrees, so their
  `spec/` folders never collide.
- Never edit a spec here after its PR closes — edit the Linear document.
- Throwaway proofs-of-concept for a spec go in `spec-poc/<ISSUE-ID>-<slug>/`, also never merged.

See [BP-037](../docs/contributing/best-practices/process.md) and
[`docs/contributing/orchestration.md`](../docs/contributing/orchestration.md).
