---
"@flow-state-dev/core": minor
"@flow-state-dev/contracts": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/testing": minor
"@flow-state-dev/devtool": minor
---

The middle execution tier is now called a **side chain**, everywhere.

Work runs in one of three places: in the turn, alongside the turn, or outliving
the turn. The middle one had three names depending on where you met it — `work`
in the methods you called, `background` in one of its own methods, and "side
chain" in the page that taught it. `background` was doing the most damage,
because it also titles the page for the *third* tier and is the umbrella term
for all three at once.

So the tiers are now sayable in one breath: **main → side chain → detached**,
and `background` goes back to meaning the umbrella over all of them.

**The sequencer DSL:**

| Before | Now |
| --- | --- |
| `.work()` | `.sideChain()` |
| `.workIf()` | `.sideChainIf()` |
| `.waitForWork()` | `.waitForSideChain()` |
| `.forEachBackground()` | `.forEachSideChain()` |

**Values you read back.** `provenance.phase` is `"main" | "sideChain"` (was
`"main" | "work"`), `provenance.workGroupId` is now `sideChainGroupId`, and
`StatusItem.backgroundTasks` is now `sideChainTasks`. The `"work"` member of
`FlowErrorScope` is now `"sideChain"`.

**Types and functions.** `RequestWorkPool` and its result/options types are
`RequestSideChainPool*`; `getRequestWorkPool` and `createRequestWorkPool` are
`getRequestSideChainPool` / `createRequestSideChainPool`;
`composeBackgroundSignal` is `composeSideChainSignal`. In `@flow-state-dev/testing`,
`WorkTrace` is `SideChainTrace` and `TestSequencerResult.workResults` is
`sideChainResults`. The DevTool's trace badge reads **SC** instead of **BG**.

**Removed: the flow-level `work` config.** `WorkConfig` and the `work` member on
`FlowDefinition` / `FlowInstance` / `FlowInstanceOptions` / `FlowType` declared
four lifecycle hooks that nothing ever invoked — a hook set there had its
declared resources registered and was then never called. They are removed rather
than renamed, so the canonical name does not inherit a contract that does
nothing. If you want per-side-chain lifecycle hooks, they need building.

**Passing `work` now throws rather than being ignored.** TypeScript rejects it
at compile time, and `defineFlow` also rejects it at runtime — on the definition
and on instance options — so plain JavaScript callers, and TypeScript callers
passing a non-fresh object, fail loudly instead of watching the config vanish.
No lifecycle behaviour is lost, because those hooks never ran. What a silent
drop would have taken with it is the resources they declared: the hooks *were*
walked for declaration discovery, so a resource declared only on one of them
was registered before and is not now. Move those declarations onto a block that
actually runs.

**One change is not just naming: this moves replay-log keys.** The tier's name
is a segment of a block's structural path (`…/work[3]` becomes
`…/sideChain[3]`), and that path is the key the replay log memoizes completed
children under. A request that is *in flight* across the deploy carrying this
change has its completed side chains filed under the old segment, so they are
not recognised and **will run a second time** on continuation. This affects only
requests interrupted before the upgrade and continued after it; nothing else
reads the path across a version boundary, and there is no migration to run.
Items stored before the upgrade keep `phase: "work"`, read back fine, and simply
render without the side-chain badge in the DevTool.

Completeness is enforced rather than asserted: `pnpm typecheck` now runs a check
that fails if the retired vocabulary reappears, in any of the four ways it was
encoded (FIX-766).
