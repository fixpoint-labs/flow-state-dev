# FIX-1915 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Claude Code's run plan record: an `observed-plan` collection declared and exported by the Claude Code package, refreshed at the end of a request. No retained spec; source [`packages/claude-code/src/sdk/work-collections.ts`](../../../packages/claude-code/src/sdk/work-collections.ts) and [the Claude Code page → Recording what the run did](../../../apps/docs/docs/tools/claude-code-sdk.md#recording-what-the-run-did) | **Amended**: the definition moves to core and gains live updates; the key, fields, keying and the "not a work queue" rule are **retained** | Epic D3 and ER-5 put one shape in core. The panel has to stay in step while the run works | [D3](DECISIONS.md#d3), PLAN S1 to S3 | The storage key and fields don't change, so stored rows read (BR-19). The Claude Code names stay, as the same objects (BR-20). Live delivery is additive for existing readers |
| FIX-1701 D2: the item-scope reader in core is internal to this repo's harnesses; source [`../FIX-1701/DECISIONS.md#d2`](../FIX-1701/DECISIONS.md#d2) | **Retained** for the reader. Its default, which the epic offered for the plan record, is **not followed** for the record | The plan record was public before it moved; internal would remove a shipped export. The reader's field was never public | [D3](DECISIONS.md#d3) | None: the reader is untouched |
| The coding-skill lab's binding: the stored id is removed when a turn asks to resume it, and written back only on confirmation; source [`labs/fsd-coding-skill/src/flow.ts`](../../../labs/fsd-coding-skill/src/flow.ts) (`consumeStateId`) | **Retained** in the lab; **not followed** in Kitchen Sink | A test bed must show a refused continuation on every turn, not move past it (epic ER-2) | [D2](DECISIONS.md#d2), PLAN S6 | The lab is unchanged |
| Epic FIX-1907 D2, D3, ER-2 to ER-6; source [`../../epics/FIX-1907/DECISIONS.md`](../../epics/FIX-1907/DECISIONS.md) | **Retained**, implemented for Claude Code and as the shared parts | — | This spec | — |

Aligned with FIX-1917's merged spec: `cursor-session` is now settled there, and a list `replacePlanList` can't store in full ends the turn *incomplete* without failing the run, as FIX-1917 BR-15b relies on.

Amended by the cross-spec check (2026-10-12); see [the epic's Evolution](../../epics/FIX-1907/EVOLUTION.md).

Amended after merge (2026-10-13, owner decision): BR-13b's allowlist is environment filtering, not a security boundary; see [How it got here](DECISIONS.md#how-it-got-here).

Re-check each source against current code before PR-A moves the record.
