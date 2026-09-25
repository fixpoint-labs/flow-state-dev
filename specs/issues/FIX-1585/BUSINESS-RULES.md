# FIX-1585 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. A human reviews this page; the plan turns it
into work.

## Posting to a channel

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A person opens `support.desk` and sends a line | The channel's own `post` action runs on that channel's session with `{ body }` and no `author`. The line appears in that panel labelled `devuser` | E2E · V6 |
| BR-2 | The page is reloaded after BR-1 | The line is still there, read back from the channel, not from the page's memory | E2E · V6 |
| BR-3 | The same text is sent to two different channels | Each lands only in its own transcript | V3 |
| BR-4 | The composer holds nothing but whitespace | Send is disabled. Nothing is posted | V5 |
| BR-5 | A post is refused (the session is not an open channel, or the post waited past the queue budget) | The panel shows the reason, the text stays in the composer, and nothing is appended | V5 |
| BR-6 | A browser post lands in a channel with a notify block | Every declared member is notified once. No one is skipped, because the poster is not a member (FIX-1476 BR-16a). No second fan-out exists | V3 |
| BR-7 | A post is sent to the `digest` channel (`support.noticeboard`) | It lands through that kind's own `post` and shows in its panel. The kind's `read` still returns only the tail | V3 · V4 |

## Reading a channel

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | Any channel panel is open | It shows the transcript, oldest first. Each line names its `author` if it has one, else its `principal`, else reads as unattributed | V5 |
| BR-9 | A seat posts while the panel is open | The line shows the next time the panel reads the channel: on reopen, or after the person's own post. It is never lost, only late | V5 |
| BR-10 | A client reads a channel's client data | It gets `transcript` and nothing else. Members and the charter stay server-side | V1 · V4 |
| BR-11 | A channel kind written by hand declares no `expose` | Its panel shows an empty transcript and still accepts posts. Nothing breaks | V1 |

## Asking a seat

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | A person opens a `support.ada` conversation and sends a note | The `desk-clerk` kind's `answer` runs with `{ note }` on that seat's session. The reply appears in that stream | E2E · V7 |
| BR-13 | The page is reloaded after BR-12 | The reply is still there | E2E · V7 |
| BR-14 | A person sends to an `agent` seat (`support.otto`) | The kind's `run` runs with `{ message }`. The reply streams in. The question itself is not kept after the reply lands, because the kind does not echo it | V5 |
| BR-15 | A person opens a `followup-runner` seat (`support.wren`) | No composer. A line says this seat runs board rows and takes no messages | E2E · V7 |
| BR-16 | A seat has no conversation yet | Its row offers "New conversation". It creates a session on that seat and opens it with the composer | E2E · V7 |
| BR-17 | A seat's action fails, or its model is unavailable | The panel shows the error and the composer is usable again | V5 |
| BR-18 | A person talks to `support.mara`, who can hire and fire | Same exposure the owner accepted for the rail's hire in FIX-1500 D6. No new permission | — (recorded) |

## What does not change

| # | When | Then | Proved by |
|---|---|---|---|
| BR-19 | A person uses the assistant | Its composer, sessions and controls behave as today | Existing E2E |
| BR-20 | The existing workforce-shell scenarios run | Green, and that file still writes to no channel | Existing VGs |
| BR-21 | A new seat kind is added to the tree | The drift test fails until the shell names its answering action or says it has none | V2 |

## Failure taxonomy

Nothing here is fatal to the page. A refused or timed-out post, a failed seat action and a
model outage all surface as an error in the panel that sent them, with the composer usable
again. A failed notification never un-writes a post: the transcript is the record, and waking
members is best-effort. Nothing retries on its own.

## Acceptance criteria this issue owns

- In a browser, a person posts to `support.desk` and sees the post in that channel's panel,
  and still sees it after a reload.
- In a browser, a person asks `support.ada` a question and sees its reply in that seat's
  conversation, and still sees it after a reload.
- The existing workforce-shell scenarios stay green.
- CLI or HTTP smoke alone is not acceptance.
