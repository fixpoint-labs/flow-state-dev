# FIX-1718 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Epic Q1 as first read: a project is a declared channel, named by a `project:` key on its workstreams. Sources: [`../../epics/FIX-1650/DECISIONS.md#q1`](../../epics/FIX-1650/DECISIONS.md#q1), ER-1, and this spec's Draft 1 | **Superseded** | Jake's [HOLD](https://github.com/fixpoint-labs/flow-state-dev/pull/2625#issuecomment-5939811709) says a project is org data. FIX-1728 shows that works; #2622 is being rewritten to match | A `projects` row and a `mintFor:` template; [D1](DECISIONS.md#d1), [D2](DECISIONS.md#d2) | Nothing stored: it never shipped |
| FIX-1727's noun map, "Q1 locked: project = channel" | **Superseded** | It's stale against the HOLD. FIX-1728 and FIX-1729 are the source | Their SPIKE.md files | Write-up only |
| FIX-1728's per-person private thread, and this spec's Draft 2 baseline | **Superseded**, on Jake's card *(Q1)* | FIX-1729: a room gives everyone on the project one conversation, and one person alone in it is the same as a thread | The room, [Q1](DECISIONS.md#q1) | Nothing stored: it never shipped |
| Epic D2, D3 and ER-3: no project record; channels are only declared; none is opened at runtime | **Amended** by #2622's rewrite, on Jake's call ([Q2](DECISIONS.md#q2)) | A project needs a row, and a conversation minted when it's made | [Q2](DECISIONS.md#q2) | Declared channels unchanged |
| FIX-1662 D2 and BR-9: with no projects, PROJECTS lists workstreams directly, and the project level shows four empty states. Source: [`../FIX-1662/DECISIONS.md#d2`](../FIX-1662/DECISIONS.md#d2) | **Amended** | Projects now ship. "A workstream is a declared channel and its boards" is **retained**, written down as ER-2 asks | [D3](DECISIONS.md#d3), BR-22 to BR-31 | A Lab with no rows lists every workstream under No project, and `/p/unassigned` keeps its route |
| The closed `CHANNEL.md` key list: `channel-binder.ts:81-89`, `apps/docs/docs/workforce/channels.md` | **Amended**, additively: `mintFor` | The epic allows one new key | PLAN S7 | A file without the key binds as today |
| A channel's transcript is its `channel-post` items in its one owner's session (`channel-flow.ts:10-23`) | **Retained** for declared channels | A room can't use it, because items live in one person's session. Rooms keep rows. Two transcript homes are left for `audit-coherence` ([PLAN follow-ups](PLAN.md#follow-ups)) | None here | Declared channels unchanged |

FIX-1719 consumes this issue's entries; it is not a predecessor.
