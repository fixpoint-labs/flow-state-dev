# FIX-1611 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, as rules. *Proved by* names the check [PLAN.md](PLAN.md#checks) runs. Who a post
reaches and that its answer lands are FIX-1610's rules; this page states them once, as the page
shows them, and covers what this issue adds.

## What a person finds

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Someone opens kitchen-sink | The rail lists one channel, `support.help`, and four seats of the `agent` kind: `support.devices`, `support.accounts`, `support.fsd`, `support.general`, each with its `description:`. No other channel, seat or kind | Goal · roster |
| BR-2 | They open a specialist | Its kind shows as `agent`. No "Hire another" anywhere on the page | Goal · roster · e2e |
| BR-3 | They look at the team panel | One board column, `escalations` on `support.help` | Goal · file |

## Asking the channel

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | A person posts to `support.help` | One specialist runs, the one the route picks; its answer lands as one line under its name, shown without a reload. Nobody else runs | Goal · answer · FIX-1590's check re-pointed |
| BR-5 | The post fits no specialist, or the route's call fails | `support.general` answers | FIX-1601 leg b |
| BR-6 | The specialist answers through `post-to-channel` | Still exactly one line (FIX-1610 BR-10), and it wakes nobody | FIX-1594's check re-pointed |
| BR-7 | A post leans on a line another specialist answered | The routed specialist's turn sees the channel's recent lines (FIX-1610 D4) | e2e · the recall scenario |

## A case that needs a person

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | The specialist decides a case needs a person | It calls `escalate` once. One row lands on `escalations` carrying the case, authored by the seat's own id, and its line says it filed | Goal · file |
| BR-9 | The post doesn't need a person | Nothing is filed | Goal · live leg |
| BR-10 | The model tries to name another author, board or channel | It can't: the tool's input is the case alone | V3 |
| BR-11 | The host hands work to an external queue | Nothing is filed; the tool says filing is unavailable and the line says so. Never a silent success | V3 |
| BR-12 | Any boot | `escalations` is reported unattended, as the only such board. Nobody drains it | Goal · file · FIX-1476's check re-pointed |

## Talking to one specialist

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | "New conversation" on a specialist, then a message | The message is the person's turn, a reply under it, both kept across a reload | FIX-1585's check re-pointed |
| BR-14 | A second message in that conversation | The model sees the earlier turns of this conversation and of no other (FIX-1612) | FIX-1601 leg c2 · V3 |
| BR-15 | A seat of a kind the page has no action for | It shows read-only with the default reason | FIX-1585's check re-pointed, the seat injected at the network |

## Hiring and old stores

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | The operator hires over `workforce-admin` with a token | The seat is hired on the `agent` kind with the given instructions, answers straight away and after a restart. It doesn't show in the rail | `durable-hire` re-pointed |
| BR-17 | A hire, or a stored row, names a kind this app no longer carries | The hire is refused and leaves no address; the stored row costs that seat alone, named at boot, left unrepaired | `durable-hire` re-pointed |
| BR-18 | `fsdev run support.general run` from the terminal | It runs as `devuser` in `kitchen-sink`, and its conversation is stored there | `cli-principal` re-pointed |

## Scripts and controls

| # | When | Then | Proved by |
|---|---|---|---|
| BR-19 | `[scenario:recall]` in the latest turn | The reply is `[reply:recall]` and every token found before that turn, in the system message or an earlier turn, and no other | V3 |
| BR-20 | `[scenario:needs-a-person]` in the turn | One `escalate` call whose case carries the post's token, then `[reply:escalated]`; `[reply:unfiled]` when the tool says it filed nothing | V3 |
| BR-21 | `[route:<member>]` in a post, in test mode | That member is routed (FIX-1610 BR-23) | V3 |
| BR-22 | `GOAL_CONTROL` is set without `KITCHEN_SINK_TEST_MODE=1` | Ignored. Every control and scenario is read only in test mode, and nothing under `packages/` reads one | V4 |
| BR-23 | Each control is on | It fails its own legs and leaves the rest green: `no-route` fails the one-specialist legs; `no-landing` the text-only answer; `no-history` recall of earlier turns; `no-filing` the board row only | VG · V5 |

## Re-pointing

| # | When | Then | Proved by |
|---|---|---|---|
| BR-24 | A goal check or e2e test reads the old roster | Re-pointed, never deleted: path and anti-game kept. A goal check keeps a failing control and gains a "re-pointed" verdict-log row; an e2e test is seen red before the fix | V5 |
| BR-25 | A leg's feature was cut (a custom kind, a drain, a DM) | That leg moves to a fixture host, preferably an existing one that proves the same shape | V5 |
| BR-26 | The page-hire test's hire half | Removed with the button; FIX-1415 restores it ([D3](DECISIONS.md#d3)) | V5 |
| BR-27 | A retained spec cites a check | Its citation still resolves; the build edits no retained spec | V8 |

## Failure taxonomy

Nothing a person does breaks the page. A failed route falls back to `support.general`; a failed
filing is said, not hidden; an old store's cut kinds cost one seat each. A control that fails
at setup, or reddens another leg, is itself a failure of this issue.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met) with both its controls seen to fail, and
every [inventory](PLAN.md#inventory) row passing on this roster, seen to fail first (a goal
check under its control, an e2e test before the fix). Epic ER-6, ER-7, ER-18, ER-19 and ER-25 to ER-27.
