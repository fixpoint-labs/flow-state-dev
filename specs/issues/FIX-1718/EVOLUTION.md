# FIX-1718 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Epic Q1's earlier reading: a project is a declared channel, named by a `project:` key on its workstreams; [`../../epics/FIX-1650/DECISIONS.md#q1`](../../epics/FIX-1650/DECISIONS.md#q1), ER-1, and this spec's Draft 1 | **Superseded** | Jake's [HOLD](https://github.com/fixpoint-labs/flow-state-dev/pull/2625#issuecomment-5939811709): a project is org data with a minted conversation. Proved workable by FIX-1728. #2622 is being rewritten to match | A `projects` row and a `mintFor:` template, [D1](DECISIONS.md#d1), [D2](DECISIONS.md#d2) | Nothing stored under the old shape: it never shipped |
| FIX-1727's noun map, "Q1 locked: project = channel" | **Superseded** | Stale against the HOLD; FIX-1728 is the source | FIX-1728's SPIKE.md | Write-up only |
| Epic D2, D3 and ER-3: no project record; channels only declared; none opened at runtime | **Amended** by #2622's rewrite, on Jake's call ([Q2](DECISIONS.md#q2)) | A project needs a row and a conversation minted when it's made | [Q2](DECISIONS.md#q2) | Declared channels unchanged |
| FIX-1662 D2 and BR-9: with no projects, PROJECTS lists workstreams directly and the project level shows four empty states; [`../FIX-1662/DECISIONS.md#d2`](../FIX-1662/DECISIONS.md#d2) | **Amended** | Projects now ship. "A workstream is a declared channel and its boards" is **retained**, written down as ER-2 asks | [D3](DECISIONS.md#d3), BR-15 to BR-24 | A Lab with no rows lists every workstream under No project; `/p/unassigned` keeps its route |
| The closed `CHANNEL.md` key list; `channel-binder.ts:81-89`, `apps/docs/docs/workforce/channels.md` | **Amended**, additively: `mintFor` | The epic allows one key | PLAN S3 | A file without it binds as today |
| A channel's members and charter are written into its session at first open; `channel-binder.ts`, `channels.md` → "Opening it" | **Retained** for declared channels; not used for talk sessions | D2 | PLAN S4 | Declared channels unchanged |

FIX-1719 consumes this issue's entries; it is not a predecessor.
