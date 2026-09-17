# FIX-1355 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

This issue builds a Proof, so its rules are the properties one run must demonstrate. **G** is the
model-free gate, **M** the model-backed check. Read it for a property the proof is missing; the
plan turns each row into a leg.

## What the files produce

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | The lab is pointed at its tree and nothing is registered by hand | Three seats, one channel, **two** documents (the org's and the pentest team's — the only files under a `resources/`) and each seat's own skills come back. No file is named in the lab's code except the root | G |
| BR-2 | A seat runs | Its `instructions` are its own `WORKER.md` body, carrying that file's token and no sibling's | G · M |
| BR-3 | A seat's skills are read | Exactly its org ∪ team ∪ own union, by name: `recon` holds three, `triage` two, `scribe` two. The two `port-scan` folders carry different tokens, and each seat holds its own team's | G |
| BR-4 | A seat reads its document | Through the resource surface, at the ref the convention mints — bare at org level, `teams/<id>/<name>` for a team's — body intact | G · M |
| BR-5 | The channel opens | At the id its two folder names mint, carrying the declared members and `CHANNEL.md`'s body as its charter | G |

## The fan-out

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | An operator posts one line, no `author` | It is appended, and the framework's fan-out wakes **exactly** the two declared members | G |
| BR-7 | A woken seat posts back under its own id | Accepted — that id is a declared member — and stored `authorVerified: false` | G |
| BR-8 | A seat's own line reaches the router | Nobody is dispatched. The transcript settles at three lines and stays there | G |
| BR-9 | A declared member has no address in the lab's router | Recorded and skipped. The other still runs; membership is unchanged | G |
| BR-10 | A `CHANNEL.md` names a member that is no hired seat | The channel still opens: membership is a declared list, not a roster check. Lands on BR-9 | G |

## Under contention · what a single seat cannot show

![Two seat lanes running at once from one fan-out, each carrying its own document, skills and instructions, converging on one queued channel session that appends both lines; a third seat in another team sits outside the fence, never woken, holding a skill of the same name as one of the others.](figures/contention.svg)

Everything a single-seat run would also show sits on one lane; the rules below exist only where
the lanes meet. The seat outside the fence is the probe a shared register would fail. The path a
post takes to get here is [SPEC.md](SPEC.md#how-a-post-reaches-a-seat).

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | Both member seats answer one post at once | Both lines are in the final transcript; neither append overwrites the other | G |
| BR-12 | Each seat's line is read | It carries its own instructions token, document token and skill names — and none of its sibling's | G · M |
| BR-13 | The non-member seat in the other team is looked for | It was never woken, and its token appears nowhere in the transcript | G |
| BR-14 | The transcript is graded | On presence and attribution, never on index. Two concurrent appends have no guaranteed order; asserting one is how a correct implementation fails | G · M |
| BR-15 | The store is closed and a fresh host is built over the same file | The transcript reads the same, line for line | G |

## Refusals, and what a run does with them

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | A request carries no org | Refused at the door by the reading block's `requireOrg`, not arriving with every document missing | G |
| BR-17 | A post claims an `author` the channel's roster does not hold | Refused `author-not-a-member`; nothing is written | G |
| BR-18 | A `WORKER.md` names a kind the lab never passed, or a `tools:` key its kind's catalog does not carry | The whole hire refuses at the mint, naming the worker. The run reports it and stops rather than running a short roster, or a seat whose declared tool reaches nothing | G |
| BR-19 | The fan-out does not complete inside the run's bound | The run fails loudly, naming how many lines it saw. Delivery is best-effort, so a short transcript must never read as a pass | G · M |

## With a real model

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | The same tree runs with a generator in the answering slot | Each member's answer names something only its own document says, and both land in the one transcript by the same path | M |
| BR-21 | The seat whose `tools:` names the lab's block answers | Its line carries the value that block mints at call time — minted in the lab's code, written in no file and in no prompt the seat is given, so only a real call can put it there. The sibling seat, which names no tool, carries none. That a seat's config *lists* the tool is never what is graded | M |

## Failure taxonomy

Two things are fatal and stop the run: a roster that will not hire (BR-18), and a channel that
will not open. Everything on the delivery path is best-effort by the framework's design — a
refused hand-off, a member with no address, a slow seat — which is why BR-19 makes a short
transcript loud rather than quiet. Nothing retries.

## Acceptance criteria this issue owns

A tree of Markdown files, pointed at once, ends as a transcript in which two file-declared seats
each answered a post using the document, skills and instructions their own folders gave them, with
a third seat silent — read back after a restart. That is the gate (G): the epic's ER-19, ER-20 and
ER-21 in one run.

The model-backed check (M) is the same claim with a model in the answering slot — plus the tool
leg (BR-21), which is M's alone because a tool slot is a generator's and the gate's answering block
is a handler. **Every rule marked M is graded by M**, not just the document one: a real model can
answer plausibly while omitting its own instructions or leaking its sibling's, so BR-2 and BR-12
are asserted on the model's own lines — the sibling's tokens as **absent**, which is the failure a
handler cannot produce and a generator can. It is what ER-19 asks for ([the epic's rules](https://github.com/fixpoint-labs/flow-state-dev/pull/1718)).
**Required at completion, not optional** — a red BR-20 is this issue unfinished, and only an
unavailable inference credential is recorded **blocked** ([D2](DECISIONS.md#d2), `goals/README.md`).
