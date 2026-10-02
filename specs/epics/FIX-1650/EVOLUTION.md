# FIX-1650 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage that spans more than one child. Child-specific lineage belongs in each child's own
evolution record.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1649's ownership row gives FIX-1650 the project level and the workstream itself (its channel, its flow, that it exists); [`../FIX-1649/DECISIONS.md#who-owns-what`](../FIX-1649/DECISIONS.md#who-owns-what), amended by #2423 | **Retained** | `labs/shift-manager/src/gaps.ts` names FIX-1650 for the four project entries | FIX-1718 fills them ([ER-8](BUSINESS-RULES.md#what-no-child-may-do)) | The frame is unchanged; only those entries are replaced |
| Channel admin (create, delete, invite) is shaped but not shipped, and worker-facing tools wait for Collab mint; [`../../issues/FIX-1415/DECISIONS.md#recommended-still-open`](../../issues/FIX-1415/DECISIONS.md#recommended-still-open), PR #2084 | **Amended** by Q1's answer: one runtime move, minting a talk session from a template on create or join, is the first instance of FIX-1341's dynamic-room lane; retire, invite and rename stay parked | FIX-1415 closed as a ratified, not-shipped explore on 2026-09-29; FIX-1341 is still parked. Projects are runtime data (Jake, 2026-10-01), and the FIX-1728 spike ([#2629](https://github.com/fixpoint-labs/flow-state-dev/pull/2629)) ran mint and join on shipped L1 | [D3](DECISIONS.md#d3), [ER-3](BUSINESS-RULES.md#what-no-child-may-do) | Declared channels unchanged; workstreams stay declared; the slice ships here, Jake's "Amend now" ([Q1](DECISIONS.md#pending-2)) |
| A channel is one named session on its kind whose id is the session id, opened at boot by `openChannels`, which alone writes its state; `packages/workforce/src/manifest.ts` (`ChannelManifest.id`), `packages/workforce/src/channel/channel-binder.ts` | **Amended** by FIX-1718 | The channel kind can't be minted from a block today: a minted one has empty state and refuses posts (FIX-1728, R1) | An internal `bind` entry on the channel kind and an optional `resourceId` on its session state ([ER-25](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) | Additive: declared channels open as before; `resourceId` is nullable, default null (BP-023, BP-030) |
| A channel's transcript is the `channel-post` items on its one owner's session; `packages/workforce/src/channel/channel-flow.ts` header | **Amended** for project rooms only, by FIX-1718 | Items live in a session and sessions don't cross users, so a room several people share keeps its lines as rows (FIX-1729 spike) | `room-lines` rows only, with no `channel-post` mirror for project talk ([ER-26](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)), decided at epic level | Declared channels keep items; project talk has one home. Whether declared channels move to rows too is flagged for `audit-coherence` |
| `CHANNEL.md`'s closed key list (`flow`, `description`, `members`, `boards`, `instructions`, `routing`, `boardActions`); `packages/workforce/src/channel/channel-binder.ts` (`DECLARABLE_KEYS`) | **Amended** by FIX-1718: one key, `mintFor:` | A template names the collection it mints for ([D2](DECISIONS.md#d2)); where app defaults declare theirs is [pending Jake](DECISIONS.md#pending-3) | `mintFor:`, the only key D2 allows | A folder without the key is a room, as today; a folder with it is not opened at boot |
| A stored seat whose kind the app no longer carries is refused, named at boot and left unrepaired; [`../../issues/FIX-1611/BUSINESS-RULES.md`](../../issues/FIX-1611/BUSINESS-RULES.md) BR-17, over [`../../issues/FIX-1475/DECISIONS.md#d2`](../../issues/FIX-1475/DECISIONS.md#d2) | **Amended** once FIX-1621 ships: the refusal stays the boot default, and a repair path is added | FIX-1621's problem statement: no path to detect and clear the orphan | [ER-5](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), owned by FIX-1621 | Boot behaviour is unchanged; repair only happens on approval, and no row is rewritten silently |
| FIX-1621's open walls: Ops as a shipped or documented template, delete-only or guided re-hire, banner or Ops seat; its Linear description, 2026-09-28 | **Amended** where Q2 reaches, retained otherwise | The admin seat's role is now this epic's question | Q2 in [DECISIONS.md](DECISIONS.md#q2); the rest stays FIX-1621's spec's call | None; nothing shipped |
| `fire` keeps the inventory row: "registered, not still hired"; `packages/workforce/src/seat-hire-blocks.ts` header and `fire`'s description | **Amended** once FIX-1621 ships | A fired seat must leave TEAMS, which reads the inventory | [ER-19](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), owned by FIX-1621 | Rows written before the change still read; one path for fire and retire |
| No seat can be hired from `org/workers/`: the roster reader passes over it and a seat id needs a team; `packages/workforce/src/loader/resource-walk.ts` and `read-workforce-directory.ts` headers | **Amended** by FIX-1719 ([Q2](DECISIONS.md#q2), answered 2026-10-01) | CoS is declared there | [ER-6](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), owned by FIX-1719 | Additive; team seats and the teams-only readers are unchanged |

No predecessor is superseded. Re-check each cited intent against current code before
implementing.

<a name="amendment--2026-10-02--cross-spec-alignment"></a>
## Amendment · 2026-10-02 · cross-spec alignment

A cross-spec review of this set and FIX-1621, FIX-1718 and FIX-1719 found surfaces that
disagreed; the EM's calls align them. It is a new PR from `main`;
[#2602](https://github.com/fixpoint-labs/flow-state-dev/pull/2602),
[#2609](https://github.com/fixpoint-labs/flow-state-dev/pull/2609) and
[#2622](https://github.com/fixpoint-labs/flow-state-dev/pull/2622) stay the review record. No rule
is added.

| Prior intent in this set | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| ER-5 and ER-20: every retire and fire asks | **Amended**, wording only | The ask exists only where a Lab passes it ([FIX-1719 D2](../../issues/FIX-1719/DECISIONS.md#d2)) | Both rules say approval holds through `askBefore`, and that DevTeam passes `["fire"]` | None; nothing shipped |
| DOCS: "asking CoS for a project" on `channels.md`; paragraph 2's template is a `CHANNEL.md` with `mintFor:` | **Amended** | FIX-1718 declares the default template org-level, in `org/resources/projects.ts` | A row of its own on `projects.md`; paragraph 2 names the org-level default and keeps a team `mintFor:` allowed | None |
| DECISIONS, Q1's narrative and pending card 3: the template is a `CHANNEL.md` with `mintFor:` | **Amended**, wording only | FIX-1718 shipped the default template org-level ([BR-6](../../issues/FIX-1718/BUSINESS-RULES.md#the-template-and-the-talk-session), #2625) | The default is declared in `org/resources/projects.ts`; a team `CHANNEL.md` with `mintFor:` stays allowed for team projects | None |
| ER-25: each talk session is minted from "the `mintFor:` template" | **Amended**, wording only | Same as the row above: the default template is org-level ([BR-6](../../issues/FIX-1718/BUSINESS-RULES.md#the-template-and-the-talk-session), #2625) | ER-25 names both sites: the org-level default in `org/resources/projects.ts`, or a team `CHANNEL.md` with `mintFor: projects` | None |
| PLAN seam: "the DevTeam profile's tree" | **Amended**: the tree, host and profile | Both children change the host's install on the agent kind and the profile | The widened seam row; the second lander adds | None |
