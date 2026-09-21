# FIX-817 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Two prior designs are touched and one is only built on. None of them has a retained
`specs/` directory — the retention convention post-dates them — so each is cited through the
code or the Linear/PR provenance that actually exists.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| **`createWorkforceCapability` — "surface agents in the capability system for DevTool discoverability", taking `agents: Agent[] \| AgentRegistry`.** Source: the file header and signature of [`packages/workforce/src/workforce-capability.ts`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/workforce/src/workforce-capability.ts) on `main` | **Amended.** The *need* is retained and refreshed; the roster parameter is superseded | The intent never shipped. The function validates duplicate agent names, returns `defineCapability({ name: "workforce" })` and carries a standing `TODO: wire registry into capability presets for DevTool agent listing`. It is a declared door with nothing behind it | [S5](PLAN.md#surfaces) — the same export installs the seats and channels sources, taking the declared roster and the live inventory keys | Breaking for any caller passing `agents`. BR-16 requires a type error naming the replacement, not a silent ignore. The export name and the capability name are unchanged |
| **`AgentRegistry` / `materializeAgent` as the seat/roster path.** Sources: [`packages/core/src/types/agent.ts`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/core/src/types/agent.ts); named in this issue's own invent-kill and in the Architect fences of 2026-09-17 (FIX-817 description) | **Superseded in part — for the workforce roster door only** | The fences rule it out as the product path for seats. It is *not* dead code: `library.ts`, `delegation-surface.ts` and `worker-materializer.ts` still resolve a skill's `agent-ref` through it, and that path works | Seats reach an agent through the seats manifest source over the declared roster and inventory ([D2](DECISIONS.md#d2)) | **Deliberately narrow.** The type stays exported from `core` and the skills delegation path is untouched. Only `workforce-capability.ts`'s use of it is removed. A wider removal is a different issue with a different blast radius |
| **FIX-1405's two-layer runtime inventory** — a declared-roster helper plus live org-scoped rows for what is open. Source: [FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405), shipped in PRs [#1920](https://github.com/fixpoint-labs/flow-state-dev/pull/1920), [#1923](https://github.com/fixpoint-labs/flow-state-dev/pull/1923), [#1928](https://github.com/fixpoint-labs/flow-state-dev/pull/1928) | **Retained whole. Not superseded** | A dependency is not a predecessor. This reads its rows and writes none; its storage keys, schemas and callers are unchanged | — | None. 817 fails if 1405's shapes move, which is why [PLAN → At implement time](PLAN.md#at-implement-time) says to re-read them rather than assume them |

**On the third row, because it is the one most likely to be misread.** FIX-1405 shipped the
answer to *what seats and channels are there*; this ships the answer to *what can I compose*,
for four domains including those two. The relationship is that 817's shape generalizes 1405's
**declared** layer across domains while 1405's **live** resource supplies the liveness half —
so the inventory *feeds* the seats/channels manifest rather than *being* it. That reading is
[D2](DECISIONS.md#d2) and it is **pending confirmation from the FSD Architect**; if it is
refuted, D2's second half changes and this row's *Treatment* stays *retained whole* either way.

Before implementation, compare these intents against the code rather than against this table.
Approved intent is not shipped behaviour — the first row is the proof of that, since its stated
intent has been in the repository, unbuilt, for as long as the function has existed.
