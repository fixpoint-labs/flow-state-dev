# FIX-1476 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

**No framework surface changes**, so the published reference owes almost nothing. What it does
owe is one cost that is true today, stated in two places and joined in neither: a channel kind of
your own means writing the channel graph yourself *and* giving up boards. A reader meets that as
a refusal at bind.

The other half is the reference app's own README, which is where somebody who cloned the app
finds out what the three `CHANNEL.md` files are for.

| Destination | Operation |
|---|---|
| `apps/docs/docs/workforce/channels.md` → *Registering a kind of your own* | Amend — two sentences added at the end of the section |
| `apps/kitchen-sink/README.md` → *The support team (`workforce/`)* | Amend — one new paragraph block after the existing three |
| `apps/kitchen-sink/workforce/teams/support/channels/*/CHANNEL.md` | New — each charter carries its own lesson (the files are the reference) |

No tracking IDs appear in any of the above.

---

## 1 · `apps/docs/docs/workforce/channels.md` → *Registering a kind of your own*

**After** the existing closing line (*"…a custom factory carries the same contract the built-in
does: one kind, one instance."*), add:

> Two things come with it, and both are worth knowing before you write the file. The factory the
> framework ships builds one kind, the built-in one, so a kind of your own is a flow you write:
> its own state, its own post, its own read. And it cannot hold a board — `boards:` on a record
> naming your kind is refused when you bind the roster, because a board's ledgers are handed to
> the built-in kind at bind time and a custom factory takes no arguments.
>
> So the question to ask is not "is this channel different" but "does this channel's *workflow*
> diverge". Different members, a different charter and a different set of boards are all one
> kind. A different `read` is not.

**Why this and not more.** It is the one thing the page states in two separate sections — the
refusal under *Working the rows*, the escape hatch here — and never joins. A reader who reads
only this section writes a kind and discovers the board rule as an error message.

## 2 · `apps/kitchen-sink/README.md` → *The support team (`workforce/`)*

**After** the existing paragraph ending *"…adding a kind takes `fsdev gen` and adding a seat
takes only a restart."*, add:

> The team also has three channels, under `workforce/teams/support/channels/`. Each one is a
> folder with a `CHANNEL.md` in it, and each is here to show a different thing.
>
> `desk` is the ordinary case: the built-in kind, five members, and two boards declared as plain
> names — `boards: [followups, escalations]`. The framework mints a ledger per name from where
> the folder sits, so `followups` is stored as `support.desk.followups` and no file writes that.
> `ada-dm` is a one-member channel with no `flow:` line, because a direct message is not a kind
> of its own — it is a channel with one member. `noticeboard` is the case that *is* different:
> it names `flow: digest`, a kind under `workforce/flows/channels/`, whose `read` returns only
> the most recent lines. A kind of your own cannot hold a board, which is why the boards are on
> `desk` and not here.
>
> The `followups` board has a seat that runs it. `support.wren` is on the `followup-runner` kind,
> which names the board in code — `channelBoard("support.desk", "followups")` — declares it as a
> resource, and exposes its drain. That wiring is explicit on purpose: a seat sees the boards it
> names and no others.
>
> **`escalations` is left unwired deliberately.** Start the app and the boot says so:
>
> ```
> [workforce] channel "support.desk" holds board "escalations" (ledger
> "support.desk.escalations"), and no flow hired in this call declares it. …
> ```
>
> That is the one failure a declared board can produce in silence — rows filed there sit pending
> with nothing said — so the reference ships in the state that shows you the message. Wire a seat
> to it the way `followup-runner` wires `followups` and the line goes away.
>
> Two things about restarts. Channels are opened at boot and opening is idempotent, so restarting
> over an unchanged tree does nothing. But re-opening is not a migration: a channel that is
> already open keeps the members and the charter it was opened with, and editing those files does
> not reach it. `boards:` is the exception — the board list is rebuilt from the files on every
> boot, so a board added to an open channel's file is usable after a restart.
>
> The channels open under one organization, named in `workforce/org.ts`. That is a storage scope,
> not a permission: this app configures no authentication, so nothing verifies it. On a host that
> does, each session takes the organization of the verified caller and the value in that file is
> ignored.

## 3 · The three `CHANNEL.md` charters

The files are the reference, so each carries its own lesson in its body rather than relying on
the README. Proposed bodies:

**`desk/CHANNEL.md`**

> Post what the desk could not close. Anything that outlives the conversation goes on a board:
> `followups` for work a seat runs, `escalations` for work a person picks up. Nothing is wired to
> `escalations` on purpose — the boot warns about it, which is what an unwatched board is
> supposed to look like.

**`ada-dm/CHANNEL.md`**

> One member. A direct message is not a kind of its own; it is this, a channel with a roster of
> one, on the kind every channel gets when it names none.

**`noticeboard/CHANNEL.md`**

> Standing notices, newest first. This one runs a kind of its own because its `read` genuinely
> differs — it returns the tail rather than the whole transcript. That is also why it holds no
> board.

## Named and not shipped

Recorded here so a reader does not conclude it is impossible: a seat can hold a board's eight
task tools and let a model work the rows itself
(`uses: [channelBoardTaskTools(board)]` — documented under *Working the rows*). The reference
does not do it, because demonstrating it needs a model in the loop and the thing being
demonstrated here is the wiring, not the model.

## Changeset

None. No published package changes; kitchen-sink and `goals/` are private
([BP-022](../../../docs/contributing/best-practices.md)). The PR says so in one line.
