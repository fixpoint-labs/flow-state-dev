# FIX-1718 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Epic Q1's recommendation: a project is a channel whose charter is the brief and whose conversation is the stream, named by its workstreams with one `CHANNEL.md` key; [`../../epics/FIX-1650/DECISIONS.md#q1`](../../epics/FIX-1650/DECISIONS.md#q1), ER-1 | **Retained**, built here | Jake chose it on 2026-10-01 and fenced it: the channel is the durable record, no project store. The amendment recording both is #2622 | [D1](DECISIONS.md#d1), [D2](DECISIONS.md#d2) | No stored data before this |
| FIX-1662 D2 and BR-9: with no projects, PROJECTS lists the workstreams directly and the project level shows four named empty states; [`../FIX-1662/DECISIONS.md#d2`](../FIX-1662/DECISIONS.md#d2), [`BUSINESS-RULES.md`](../FIX-1662/BUSINESS-RULES.md) BR-9 | **Amended** | Projects now ship. D2's "a workstream is a declared channel and its boards" is **retained**, and written down here as ER-2 asks | [D3](DECISIONS.md#d3), BR-17 to BR-26 | A Lab with no `project:` line lists every workstream under No project; `/p/unassigned` keeps its route |
| The closed `CHANNEL.md` key list; `channel-binder.ts:81-89` (`DECLARABLE_KEYS`), `apps/docs/docs/workforce/channels.md` → "Declaring a channel" | **Amended**, additively: one key, `project` | The epic's D2 allows at most one | PLAN S1 | A file without the key binds as today |
| The channel inventory row is `{ id, kind, members, openedAt }`; `inventory/collections.ts:105-114`, `apps/docs/docs/workforce/inventory.md` → "What each row holds" | **Amended**, additively: `project` | The row is how a browser and a seat read the declared channel | PLAN S3 | `null` on an older row (BP-030); rewritten at the next boot |
| A channel is a session at its own id, opened for one user and bound to them; `manifest.ts:143-149`, `channels.md` → "What a channel is" and "Opening it" | **Retained** | Jake's fence calls for sessions as participation handles; sessions per participant are a separate follow-up on his call, not this issue. What a project is lives on the org-scoped row, not in that session | None here | Unchanged, user isolation included |

Nothing is superseded. FIX-1719 consumes this issue's project channel; it is not a predecessor.
