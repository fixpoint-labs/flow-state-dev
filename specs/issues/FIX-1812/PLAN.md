# FIX-1812 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md)

## Gate

Start only after FIX-1811 merges. Rebase on `main`, then re-run the checker: sites may have moved
under FIX-1786 work.

<a name="sites"></a>
## Sites

From `node specs/issues/FIX-1812/poc/sweep/sweep.mjs` on `028d3547`. The script's `EXPECTED` map is canonical; this table is a readable copy. On a rebase, update `EXPECTED` first.

| Site | Verdict |
| --- | --- |
| `packages/shift-manager/teams/devteam/host.mts` · `hire` | replace with `.as()` |
| `packages/shift-manager/teams/devteam/host.mts` · `setWorkstreams` | replace with `.as()` |
| `apps/docs/docs/workforce/projects.md` · `createProject`, `setWorkstreams` | replace with `.as()` |
| `apps/docs/docs/workforce/chief-of-staff.md` · `hire` | replace with `.as()` |
| `packages/workforce/README.md` · `hire` | replace with `.as()` |
| `apps/kitchen-sink/lib/mailbox-post-control.ts` · `post-to-mailbox` | name the inline dispatcher directly (E2), or drop the entry if FIX-1786 removed the file (E4) |
| `host.mts` · `createProject` (`.tapIf`), `setRepository` (`.tap`), `fire` (`.tap`) | keep: approval before the write |
| `chief-of-staff.md`, `workforce/README.md` · `fire` | keep: approval tap |
| `packages/workforce/src/mailbox-post-capability.ts` · `post-to-mailbox` | keep: signs, routes, maps |
| `packages/memory/src/tools/recall-tool.ts` · `memory/recall` | keep: stepIf and rescue |
| `packages/orchestration/src/skills/delegation-surface.ts` · run-board tool | keep: two steps |
| `packages/tools/src/bash/blocks.ts` · `bash`, `bash-read-file`, `bash-write-file` | keep: cold sandbox setup |
| `packages/claude-code/src/sdk/workspace.ts` | keep: taps around the step |
| `labs/fsd-coding-skill/src/flow.ts` | keep: input connector |
| `apps/kitchen-sink/workforce/blocks/escalate.ts` · `escalate` | keep: branches |
| `packages/integration-tests/.../artifact-flow.ts` · `write-artifact` | keep: tap |
| `packages/core/test/flow-config.test.ts` · `nested-tool`, `static-nested-tool` | keep: the test's subject (E3) |
| 893 sequencers with no `description` | out of scope (D1) |

## Sequence

One PR: replace the code sites, then the docs and README examples, then update the checker's
expected list so the replaced sites read as gone. Remove imports the replacements orphan
(`sequencer`, the copied schema imports) only where nothing else uses them.

## Checks

- The sweep checker passes on the implementation head.
- `pnpm --filter @flow-state-dev/shift-manager test` and `pnpm typecheck` pass.
- One test asserts the chief of staff's model-facing name and description for `hire` and
  `setWorkstreams`, if no existing test does. It must fail if `.as()` is dropped and the bare
  Workforce block (`workforce-hire`, `project-set-workstreams`) is passed instead.

## Guardrails

- Don't touch a `kept` site, because the issue keeps real behaviour out of scope.
- Docs prose around the examples says "worker", never "seat", because Jake is retiring the term.
- No changeset: no published API changes (BP-022).

## Docs

See [DOCS.md](DOCS.md): code-example updates on two pages and one README.

## POC

`poc/sweep/sweep.mjs`: the factual base of this spec. Totality assertion; `--control` plants an
unlisted wrapper and a stale expected entry and prints `CONTROL PASS` only when both fail.

## Notes from review

- (cursor, #2873) An exception-only manifest would shrink `EXPECTED` by about half; trade-off is
  the kept sites' reasons leave the data. Implementer's call if the list churns on rebase.
- (cursor, #2873) Keys like `name` and `RUN_BOARD_TOOL_NAME` are the unresolved name
  expression; fine for frozen evidence, revisit if they churn.

## Follow-ups

- Action-root one-step sequencers that only wrap a block could take the block directly. Not
  this issue (D1).
