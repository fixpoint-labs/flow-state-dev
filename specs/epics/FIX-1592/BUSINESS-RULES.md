# FIX-1592 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The constraints every child obeys, and what a cross-spec review checks. Numbers are stable:
shipped children cite ER-1 to ER-20. The 2026-09-27 amendment adds ER-21 to ER-28 and marks
what it retires.

## What a person gets

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-21 | A post to a routed channel runs exactly one member: the one whose `description:` fits, picked with one model call, or the fallback member when none fits or the call fails ([D5](DECISIONS.md#d5)) | Routed channel | Its browser check · FIX-1601 leg b |
| ER-22 | The routed specialist's answer is a line in the channel, authored as the seat, every time, tool call or not ([D6](DECISIONS.md#d6)) | FIX-1610 | Its check on a script that never calls the tool · the smoke |
| ER-23 | An open channel view shows a line another request posted, with no reload, and which seats are working ([D4](DECISIONS.md#d4)) | FIX-1609 | Its no-reload check, red on today's `main` · FIX-1601 leg a |
| ER-24 | A specialist hears only posts routed to it, in its own conversation for that channel. The route reads recent lines, so a follow-up stays with its specialist | Routed channel decides · FIX-1610 consumes | Routed channel's check · FIX-1601 leg b |
| ER-25 | A case that needs a person becomes an `escalations` row, filed by the specialist through the channel's own `fileTask`, and the specialist says so. Nobody drains it; the boot warning stays | Rebuild | Its browser check · FIX-1601 |
| ER-26 | The support team is [D7](DECISIONS.md#d7)'s roster; what else leaves the page follows [O1](DECISIONS.md#o1) | Rebuild | Its spec review |
| ER-1 | A message to a seat, and its reply, survive a reload in that seat's conversation | FIX-1585, shipped | FIX-1601 leg c |
| ER-2 | A post with no seat author to an **unrouted** channel runs each member agent once. A routed channel follows ER-21 | FIX-1590, FIX-1602, shipped | `a-fresh-host-wakes-its-member-agents` |
| ER-3 | A post authored by a seat wakes no seat ([D2](DECISIONS.md#d2)) | FIX-1602, shipped · routed channel, FIX-1610 consume | Their spec reviews |
| ER-4 | A seat posts only to its own channels, as its own id, set on the server | FIX-1594, shipped · FIX-1610 consumes | FIX-1610's spec review |
| ER-5 | A seat's line shows under its name and survives a reload | FIX-1594, shipped | FIX-1601 leg a |
| ER-6 | One kind→action map; with the clerk cut it has one row, `agent` → `run` | FIX-1585, shipped · rebuild consumes | Rebuild's spec review |
| ER-7 | One scripted model, one script file. The routed channel adds its classifier's entry; FIX-1610 a scenario that never calls the post tool | FIX-1585 · new children consume | Each browser check, keyless |
| ER-20 | *Retired:* the clerk kind is cut. Its no-parrot intent holds for every specialist; its filing is ER-25 | — | — |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-8 | Change Workforce only where a path needs it. Engine, client and react may gain a session-wide live stream in their own words. No Workforce word below Workforce; no Layer 1 channel, notify, route or dispatch piece | The layer rule. [D4](DECISIONS.md#d4) lifts "no engine change" |
| ER-9 | No kitchen-sink-only route or API. The live view uses the framework's stream, never a poll or remount | A reference app teaches its fixes |
| ER-10 | No second kind→action map, no invented Dispatcher | Architect fence |
| ER-12 | A seat's answer is a peer post. The route picks who hears; it never answers or posts | A channel is a log of posts |
| ER-13 | No board drain or board UI, no change to who attends `escalations` (FIX-1591); no hired specialist joining a channel (FIX-1415); no verified identity (FIX-1493) | Each is its own decision |
| ER-27 | No goal check or e2e spec that reads kitchen-sink is deleted. Each is re-pointed at the new roster or a fixture host, keeps its anti-game and control, and says so in its verdict log. Retained specs stay untouched | A green `main` that stopped checking is what this epic is fixing |
| ER-11 | *Lifted:* FIX-1459 merged | — |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-14 | FIX-1609, the routed channel and FIX-1610 build in parallel. The rebuild builds after the routed channel and FIX-1610 merge. FIX-1601 runs after every other child. Blocked-by holds implementation only | [D1](DECISIONS.md#d1) |
| ER-15 | A child that needs a Workforce word below Workforce, or a key for a gated leg, stops and comments up here | The Kill line |
| ER-16 | *Done:* FIX-1585 folded ER-1 | — |
| ER-28 | FIX-1601's QA plan is amended, in a follow-up to its retained spec, to carry ER-17 before its next run | Its plan grades after a reload, on the old roster |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| ER-17 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) holds on one `main` commit, production build, keyless: leg a with no reload, red on today's `main`; leg b, one specialist per post; leg c, direct talk. Then the smoke, with no missing answer. Every named control seen to FAIL | FIX-1601's amended plan (ER-28) |
| ER-18 | Every check and e2e spec that reads kitchen-sink is green on that commit (ER-27). `a-fresh-host-wakes-its-member-agents` still finds kitchen-sink's notify builds no router or dispatcher | Rebuild's PR · FIX-1601 part 3 |
| ER-19 | The kitchen-sink README tells the support story | [DOCS.md](DOCS.md) · the rebuild publishes |
