# Retained issue and epic specs

This directory preserves reviewed design intent and authored evidence. It is not the
current-behavior reference: use `docs/architecture/` and the published user docs for
what the system does now, then compare the spec to the implementation.

| Owner | Directory | Template |
|---|---|---|
| Issue | `issues/<ISSUE-ID>/` | [Issue template](../docs/contributing/spec-template.md) |
| Epic | `epics/<EPIC-ISSUE-ID>/` | [Epic template](../docs/contributing/epic-spec-template.md) |

Each set contains `SPEC.md`, `DECISIONS.md`, `BUSINESS-RULES.md`, `PLAN.md`, and
`DOCS.md`, with conditional `EVOLUTION.md` for relevant predecessor designs.
Authored `figures/`, `assets/`, and `poc/<experiment>/` stay with that owner.
The templates include worked documentation-draft and multi-predecessor evolution examples.

The canonical rules are in **[Spec retention and authority](../docs/contributing/orchestration.md#spec-retention-and-authority)**.
For approval, required repository checks, confirmed merge and subsequent changes, use
**[Merging and amending a spec](../docs/contributing/orchestration.md#merging-and-amending-a-spec)**.
Linear carries status and links; the repository carries the spec. Original merged PRs
preserve review history, and later amendments use follow-up PRs from `main`.

## Reading and using experiments

A retained POC records an experiment, not a supported API. Its instructions should name
what it checks, how to run it explicitly, the observed result and its limits. Do not import
it into production, make it a workspace package, or add it to default builds or test/lint/knip
discovery. Retain authored sources and evidence, not dependencies, build output or secrets.
Graduate useful behavior through the normal implementation path rather than copying
experimental code into a package.

## Exceptions and history

[Project specs](../spec/README.md) keep their existing never-merged lifecycle at
`spec/_projects/<slug>/`. Historical closed specs and unrelated old experiments are not
backfilled or rewritten. A missing retained predecessor is cited through its real
PR/Linear provenance, never through a fabricated local file.
