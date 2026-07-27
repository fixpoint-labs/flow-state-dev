# Specs

Implementation specs, one per Linear issue: `docs/specs/<ISSUE-ID>.md` (e.g. `FIX-775.md`).

A spec is authored by `issue-spec`, opened as its own PR (branch `spec/<ISSUE-ID>`)
so the project's automated reviewers critique the design *before* any code is written,
and mirrored to the issue's Linear document — the two copies are kept in sync (BP-037).

The Linear issue states *what* and *why*; the spec states *how*. `issue-implement`
reads the spec from here.
