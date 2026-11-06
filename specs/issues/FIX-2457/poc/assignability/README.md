# Assignability probe

**Question.** Which typed block contexts fail to pass as `BlockContext`, and what removes the
`ctx as never` casts in `packages/*/src`? The issue guessed scope state schemas.

**Run.** Copy `probe.test-d.ts` into `packages/core/test/`, then from `packages/core`:
`npx tsc -p tsconfig.test-d.json`. Build `@flow-state-dev/contracts` first. To try the fix,
`git apply` `core-types.diff` from the repo root.

**Results at `main` d6a38c09.**

| Case | Today | With `core-types.diff` |
|---|---|---|
| p1 to p7, scope and own state, parent state | passes | passes |
| u1, u4, a handler with `uses: [cap]` | fails on `targets` | passes |
| `pre`, a preset `tools` callback | fails: `CapabilityPresetCtx` lacks 15 members | passes, and `ctx.session.state` is typed |
| t1, a block that declares `targetStateSchemas` | fails on `targets` | still fails |

t1 passes when `BlockContext`'s `TTargets` default is widened to `Record<string, ZodTypeAny>`, but
then a block with no targets also reads an open `ctx.targets`, and `sequencer.ts:2128` stops
compiling. The block factories lean on that default, so the precise fix there is the
implementer's (see DECISIONS.md D3).

**The sweep.** Every `ctx as never` in `packages/*/src` replaced by `ctx`, dependencies built,
`tsc --noEmit -p tsconfig.json` per package:

| | core | orchestration | workforce | harness-manager | integration-tests |
|---|---|---|---|---|---|
| Casts | 1 | 8 | 176 | 9 | 2 |
| Errors, today's types | 1 | 0 | 14 | 0 | 0 |
| Errors, with `core-types.diff` | 1 | 0 | 2 | 0 | 0 |

The 14 in workforce are 12 preset-callback sites and 2 local narrow types
(`project-coordinator.ts:251`, `workstream-writes.ts:596`). Core's one is a narrow local type
meeting a symbol seam (`pull-request-recorder.ts:131`). With the diff, `patterns`, `memory`,
`tools`, `engine` and `testing` also compile clean. `harness-manager/test/claim-host.ts`'s five
`@ts-expect-error` lines for the capability bug become unused, and `tools/test/mcp/filter.test.ts`
stops compiling: it builds a partial preset context by hand.

The other spellings, `ctx as BlockContext` (19) and `ctx as unknown as BlockContext` (10), stripped
the same way with the diff applied: 25 of 29 are not needed. The four left are local narrow types
(`workforce` `plan.ts:395,400` and `run-project.ts:85`, `harness-manager` `manager.ts:1915`).
