# `spec/` — the project-spec exception

New issue and epic specs belong in [`specs/`](../specs/README.md), not here.
Their canonical [retention and authority policy](../docs/contributing/orchestration.md#spec-retention-and-authority)
includes approval-time merge, required documentation drafts, conditional evolution,
and follow-up amendments.

## Project specs stay unchanged

A Linear project's standing set remains at `spec/_projects/<slug>/` on its
never-merged `project/<slug>` PR. It has the original four documents (`SPEC.md`,
`DECISIONS.md`, `BUSINESS-RULES.md`, `PLAN.md`) and figures, follows the
[project template](../docs/contributing/project-spec-template.md), and keeps its
existing Linear project-content mirror and epic-level refresh lifecycle.
`absorbed/linear-content.md` preserves the project's original hand-written content
verbatim; it is not edited after capture.

This exception does not make project content eligible for `main`. The guard keeps
project isolation separate from retained issue/epic artifacts.

## Historical material

Do not bulk-migrate old issue/epic branches, rewrite archives, or backfill historical
closed specs. Their PRs and Linear documents remain valid provenance. New designs
cite those real sources when no retained artifact exists, rather than inventing a
local `specs/` path. Existing branch names need not change to use the new directories.
