# FIX-1594 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Each says what a person, a seat or the system does and what happens.
The *proved by* column is the check the plan runs. Epic rules are cited as ER-n. BR-14 moved to
SPEC's *What stays*. BR-18 went to FIX-1589 with the hire's rules for `seatId`.

## A seat posts

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A seat holding `post-to-channel` calls it with a channel it belongs to and a body | One line lands in that channel through the channel's own `post`: `author` is the seat's id, `principal` is the request's user, `authorVerified: false` (ER-4, D2) | V1 · POC P1 |
| BR-2 | The same, on a turn a channel post woke | The same line. Being woken changes nothing about how a post is made | V2 · goal check · POC P2 |
| BR-3 | A seat is talked to directly and posts to one of its channels | The line lands, and like any seat-authored line it wakes no seat (ER-3) | V1 |
| BR-4 | The model sends an `author`, or any key besides `channel` and `body` | The tool refuses the call; nothing is posted | V1 · POC P3 |
| BR-5 | The seat names a channel it is not a member of | The channel refuses the post (`author-not-a-member`) and writes nothing. The seat's turn goes on; the tool said only that it handed the post over (D3) | V1 · POC P4 |
| BR-6 | The seat names a channel id nobody opened, or one on a kind whose `post` another flow can't call (`support.noticeboard`) | Refused by name; nothing is written anywhere | V1 |
| BR-7 | A seat whose worker file does not name the tool is asked to post | The model is not offered the tool, and nothing is posted (the `tools:` fence) | V1 · POC P5 |
| BR-8 | The body is empty | Refused by the tool's input, as the channel's `post` would refuse it | V1 |
| BR-19 | The host's dispatcher hands work to an external queue | The dispatch refuses a delivery into the channel's existing session before anything is enqueued (`external-dispatcher`). The tool call fails naming it; nothing is written | V1 |

## Who the line reaches

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | A seat's line lands in a channel | Its fan-out wakes no seat (ER-3, FIX-1590's filter). The notify stub still names non-agent members, as for any post | V3 · goal check |
| BR-10 | The seat's line lands on a channel with a notify slot but no FIX-1590 filter | The writer is still skipped (the app's stub compares `author`), and the other members are notified. Why the author is required on every seat post | POC P2, and its negative control |
| BR-11 | Two seats post into one channel at once | Both lines land, in order; posts on one channel queue | Existing channel suite |

## What a person sees

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | A person opens `support.desk` after otto posted | Otto's line, labelled `support.otto`, in time order with the rest (ER-5, FIX-1585's label rule: author, else principal) | Goal check |
| BR-13 | The page is reloaded | The line is still there: it is the channel's own `channel-post` item | Goal check |
| BR-15 | A person reads `support.otto`'s own conversation | The woken turn and its tool call are there; the channel line is not copied into it (ER-12) | V2 |

## The seat's own name

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | Any seat posts: hired from files, at runtime by `hire`, or by the boot reload | The line's author is that seat's `seatId`: the seat record's id, the name `members:` lists, which FIX-1589 has the hire impose on every seat ([FIX-1589 D3](../FIX-1589/DECISIONS.md#d3)). For an org-prefixed hired seat that is not its address, and the member check passes on the record id | V1 (a runtime-hired seat) · FIX-1589's checks for the key itself |
| BR-17 | A seat's settings carry no `seatId` | The tool refuses the call by name and posts nothing. It never falls back to the principal or to its input | V1 |

## Failure taxonomy

A refused call never writes a line and never fails the channel. A refusal the tool can see fails
the tool call: bad input (BR-4, BR-8), no `seatId` (BR-17), or a refusal the dispatch returns at
once (BR-6, BR-19). A refusal only the channel can see (not a member, BR-5) lands on the channel's
request log and the seat's turn completes.
Nothing retries. Every path leaves the transcript as it was.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): on kitchen-sink's production build with
the scripted model, a marked post to `support.desk` produces one line labelled `support.otto` that
survives a reload, while `support.iris` and `support.otto` are each woken once. The same run fails
under `GOAL_CONTROL=no-author-filter` and under `GOAL_CONTROL=post-without-author`. The epic's
ER-19 README text is published last, once every sentence in it is true.
