# `spec/` — the in-flight spec, and nothing else

This folder holds **one spec at a time, on a spec branch, and never on `main`.**

`issue-spec` writes `spec/<ISSUE-ID>/` here on branch `spec/<ISSUE-ID>` and opens the spec PR
for review. An epic's set lives at `spec/_epics/<name>/` on branch `epic/<name>`. The spec PR
closes unmerged once the spec is approved (an epic PR stays open for the life of the epic); the
branch is kept, so the reviewed copy stays fetchable, but it never lands on `main`. CI blocks any
other PR that carries a file here, so a spec cannot reach `main` by accident or by a
well-meaning "land the approved spec" commit.

## What a spec is

Four documents and a folder of figures — one directory, not one file:

| File | For | Carries |
|---|---|---|
| `SPEC.md` | The product owner | Who feels the change, before and after · the figures · the sign-off |
| `DECISIONS.md` | Whoever asks *why* | Each decision as a card: instead of · because · locks in · what lost |
| `BUSINESS-RULES.md` | A human reviewer | The cases as rules: when → then → proved by |
| `PLAN.md` | The implementing agent | Surfaces, the build DAG, checks, pinned names, guardrails |
| `figures/*.svg` | Everyone | The pictures where position is the content |

The shape and the worked examples: [`docs/contributing/spec-template.md`](../docs/contributing/spec-template.md)
(issue) and [`docs/contributing/epic-spec-template.md`](../docs/contributing/epic-spec-template.md)
(epic). The figures: [`docs/contributing/spec-figures.md`](../docs/contributing/spec-figures.md).

## Where specs actually live

**Linear.** The issue's attached document is the spec, and it is the only durable copy: the four
documents in reading order, with the figures linked to the retained branch. The repo deliberately
keeps none — a spec is a point-in-time plan, and a folder full of them is a corpus that decays
without anyone noticing.

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
cite a document.** A pointer to a spec path — a document or a figure — rots the moment the spec
closes, and CI rejects one.

## Conventions

- One spec per spec branch. Parallel issues run on their own branches and worktrees, so their
  `spec/` folders never collide.
- Never edit a spec here after its PR closes — edit the Linear document. The retained branch
  is a frozen record of what was reviewed, not a live copy. **One exception:** a PR re-opened
  to publish a post-approval POC is live again for as long as it is open
  ([`spec-poc`](../.agents/skills/spec-poc/SKILL.md)).
- An epic's set is the opposite: it is **refreshed for the life of the epic** — the set table's
  status, the dependency graph, and the path figure move as issues are filed and finish.
- Throwaway proofs-of-concept for a spec go in `spec-poc/<ISSUE-ID>-<slug>/`, also never merged.

See [BP-037](../docs/contributing/best-practices/process.md) and
[`docs/contributing/orchestration.md`](../docs/contributing/orchestration.md).
