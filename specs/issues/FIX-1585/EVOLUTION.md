# FIX-1585 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The picked channel or seat panel is read-only, and every message from the page goes to the assistant. Shipped in FIX-1477 PR-C ([#2113](https://github.com/fixpoint-labs/flow-state-dev/pull/2113), commit `24a0829`, `PickedSessionPanel` in `apps/kitchen-sink/app/page.tsx`). No spec card decided it; the retained [FIX-1477 set](../FIX-1477/SPEC.md) scopes the rail and panels, not a composer | **Superseded** for channels and for seats whose kind answers; **retained** for seats whose kind has no answering action | The Workforce half of the page was the only half that could not be talked to. The owner filed that as the gap | [D3](DECISIONS.md#d3), BR-1, BR-12, BR-15 | The assistant's composer is untouched (BR-19) |
| A channel's transcript is server-side session state; `read` is its projection. [FIX-1476](../FIX-1476/SPEC.md) and the channel kind's own header | **Amended**: `transcript` alone also crosses to the client. `read` is unchanged, for models and flows | A browser cannot receive `read`'s output, and a post leaves nothing in the stream ([poc P3](poc/talk-premises/README.md)) | [D1](DECISIONS.md#d1) | Additive. No stored shape changes; members and the charter stay private |
| Declare what a browser reads as a projection, never bare. [FIX-1477 PLAN → the board's read](../FIX-1477/PLAN.md#br20-transport) | **Retained**, applied to the transcript | The same reasoning: expose one named field, not the whole state | D1, BR-10 | — |
| A post naming no author notifies every declared member. [FIX-1476 BR-16a](../FIX-1476/BUSINESS-RULES.md#the-dm) and [D6 → which identity](../FIX-1476/DECISIONS.md#author-identity) | **Retained** unchanged | For a person posting from the page, who is not a member, that rule already means "everyone except the poster" | [D2](DECISIONS.md#d2), BR-6 | — |
| A DM between a person and an agent is a session on the agent's flow, not a channel. The owner, in [FIX-1476 D6](../FIX-1476/DECISIONS.md#d6) | **Retained** | A seat's conversation is exactly that session, and its composer calls the seat's own action | D3 | — |

Nothing is wholly superseded. Before building, compare the FIX-1476 rows with the current
`channel-flow.ts` and the kitchen-sink notify block; the probe in
[`poc/talk-premises/`](poc/talk-premises/README.md) shows they held on `689c72e`.
