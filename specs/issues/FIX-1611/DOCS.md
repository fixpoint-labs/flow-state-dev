# FIX-1611 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Drafted by the spec author, not by `docs-writer`: this session could not dispatch it. The
implementer runs `docs-writer` and then `docs-editor` over these drafts against what shipped,
before publishing. It starts from the [epic's draft](../../epics/FIX-1592/DOCS.md) and departs
from it in one place: the epic's "each specialist keeps only its own cases … say it again" is
replaced by FIX-1610's rule, that the answering specialist sees the channel's last 20 lines
([FIX-1610 D4](../FIX-1610/DECISIONS.md#d4)).

## UPDATE · `apps/kitchen-sink/README.md` · "The support team (`workforce/`)" through the end of "Channels", replaced whole

Headings are as they publish.

> ### The support team (`workforce/`)
>
> The support team is one channel and four specialists, declared in files rather than wired in
> code.
>
> Open `support.help` in the rail and ask a question. The channel sends each post to the one
> specialist whose job fits it: `support.devices` for printers, laptops, phones and wifi,
> `support.accounts` for sign-in and billing, `support.fsd` for questions about building with
> flow-state-dev, and `support.general` for anything else. You see which specialist is working
> on it, then its answer as a line under its name, without reloading.
>
> Each specialist is a `WORKER.md` under `workforce/teams/support/workers/`. Its `description:`
> is its job, and it is what the channel reads to decide who answers:
>
> ```md
> ---
> description: Printers, laptops, phones, wifi and anything else with a power button.
> tools: [post-to-channel, escalate]
> ---
>
> You are the support team's devices specialist. Answer in a sentence or two, and say plainly
> when you don't know. When a case needs a person, file it with `escalate` and say you did.
> ```
>
> None of the four names a `flow:`, so all of them run on the built-in agent kind.
>
> #### How a post finds its specialist
>
> Routing is two lines in `workforce/teams/support/channels/help/CHANNEL.md`:
>
> ```md
> routing:
>   fallback: support.general
> ```
>
> and one in `workforce/hire.ts`, where the channel kind is built with
> `routeByPurpose(seats, { model: ROUTE_MODEL })`. For each post from a person, if their last
> post is still waiting on a specialist, this one goes there too. Otherwise one evaluator call
> picks a specialist from the four descriptions, reading the channel's recent lines along with
> the post. (An evaluator is a block that answers a typed question with one model call.) If that
> call fails, `support.general` takes the post. Only the chosen specialist hears it.
>
> `ROUTE_MODEL` lives in `lib/models.ts`. It has to be a model that can evaluate, and not every
> chat model can: see [Evaluation models](../docs/docs/fundamentals/models.md#evaluation-models).
>
> The specialist answers with the channel's last 20 lines in view, so "where can I buy it?" finds
> its "it" even when the laptop came up with a different specialist. Its own conversation for
> the channel keeps only the posts routed to it and its answers, so something said further back,
> to someone else, may need saying again.
>
> Take the `routing:` lines out and every specialist hears every post, which is what a channel
> does by default.
>
> #### When a case needs a person
>
> A specialist that decides a case needs a person calls `escalate`, a tool in
> `workforce/blocks/escalate.ts`. It files one row onto the channel's `escalations` board through
> the channel's own `fileTask` action, signed with the specialist's own id, and the specialist
> says so in its answer. The model chooses only what the row says. The rows show in the team
> panel's `escalations` column.
>
> Nobody works `escalations` in this app, and the boot says so:
>
> ```
> [workforce] channel "support.help" holds board "escalations" (ledger
> "support.help.escalations"), and no flow hired in this call declares it. …
> ```
>
> Rows piling up with nothing said is the one failure a declared board can produce in silence,
> so the reference ships in the state that shows you the message.
>
> Filing needs the in-process dispatcher. Run the app with `FSD_BULLMQ_DISPATCH=1` and a
> specialist still answers, but says it couldn't file.
>
> #### Talking to one specialist
>
> Open a specialist in the rail and start a new conversation to talk to it directly. That
> conversation is separate from the channel and keeps both sides across a reload. The specialist
> sees the earlier turns of that conversation and nothing from any other.
>
> ```bash
> pnpm fsdev run support.devices run -i '{"message":"My phone stopped charging."}'
> ```
>
> #### Where the pieces come from
>
> Tools, blocks and capabilities come from files too: a file under `workforce/blocks/` or a
> `resources/` folder becomes an entry in `workforce/workforce.gen.ts` when you run `fsdev gen`.
> That module is committed, so the code an app can run is fixed when you run the command, which
> is what lets a bundler see it. The roster is read at boot: `hireKitchenSinkWorkforce()` walks
> `workforce/teams/` and hires a seat per `WORKER.md`. Adding a specialist means a folder, a line
> in the channel's `members:`, and a restart. Adding a tool means a file and `fsdev gen`.
>
> Channels are opened at boot, and opening is idempotent. Re-opening is not a migration: an open
> channel keeps the members and charter it was opened with. `boards:` and `routing:` are the
> exceptions, read from the file on every boot.
>
> A seat's post wakes nobody, so a specialist's answer never sets off another. The check is on
> the claimed `author`, which the channel does not verify; an app with a real identity model
> should compare whatever it resolves a caller to.
>
> *(Keep, unchanged: the paragraph linking "which organization a channel runs in".)*

## UPDATE · `apps/kitchen-sink/README.md` · "One organization", the bold sentence and the one after it

> … and it means **anyone who can open a deployed copy of this app can post to its channel and
> talk to its seats, on your model key**. If you deploy it somewhere other people can reach, put
> sign-in in front of it first.

## UPDATE · `apps/kitchen-sink/README.md` · "Hiring while the app runs"

First paragraph: "`support.ada` and the rest are declared in files" becomes "The four specialists
are declared in files", and the hired seat's example id `support.bo` becomes `support.new-hire`
throughout, so it can't be read as a fifth specialist. The hire example becomes:

> ```bash
> curl -X POST localhost:3000/api/flows/workforce-admin/actions/hire \
>   -H 'content-type: application/json' \
>   -H "authorization: Bearer dev-token" \
>   -d '{"userId":"you","input":{"seatId":"support.new-hire","flow":"agent","instructions":"You take refund questions."}}'
> ```

Delete "The rail's **Hire another** and mara's `hire` tool don't need a token." The `fire`
paragraph becomes:

> The admin flow also has a `fire` action, which removes a seat the admin action hired. A hired
> seat doesn't show in the rail and doesn't join `support.help`: a channel's members are the ones
> its file names. Hiring from the page comes back once a hired specialist can join the channel.

The call example posts to `…support.new-hire/actions/run` with `{"message":"Where is my order?"}`.

## REMOVE · `apps/kitchen-sink/README.md`

- "A seat that hires", whole.
- The clerk's CLI and HTTP examples, and "Or open the seat in the app's rail and type the note
  there."

## UPDATE · `apps/kitchen-sink/README.md` · Web Application

> - **Seats**: Open a seat in the rail to see its kind, under its row.
> - **Channels**: Open `support.help` in the rail to read it and post. Your post calls the
>   channel's own `post` action, the same one `fsdev run` calls, and appears as `devuser`, the
>   one user this app runs as. Lines other requests post appear while the view is open, and the
>   view shows which specialist is working.
> - **Seats**: Open a specialist's conversation to talk to it directly. Your message and its
>   reply stay in that conversation.

## UPDATE · `apps/kitchen-sink/README.md` · Architecture

`workforce/` becomes "The support team: `teams/`, the `escalate` tool under `blocks/`,
`workforce.gen.ts`". `workforce-admin/` becomes "The operator's hire and fire actions".

## UPDATE · `CLAUDE.md` · package map, `apps/kitchen-sink` row

> Canonical reference app (Next.js): a support desk on Workforce, and the other subsystems it
> hosts. Features with no job in it are proven by fixture hosts under `goals/`.

## UPDATE · `docs/atlas/workforce.html` line 2739 and `docs/atlas/conductor.html` line 447

"its channel flow, desk-clerk worker kind, workforce hiring, and generated resource maps" becomes
"its routed support channel, the built-in agent kind, the operator's hire, and the generated
module". In `conductor.html`, `workforce/flows/workers/desk-clerk.ts` becomes
`workforce/blocks/escalate.ts`.

## Publication ownership

This issue publishes all of the above in its implementation PR, after VG, once every sentence is
true on `main` (ER-19). FIX-1606's gateway-key paragraph in Setup stays word for word. FIX-1610
owns the channels guide's routing section; FIX-1609 owns the live view in the react and client
docs.

## Not changed

`apps/docs/docs/workforce/durable-hire.md` and `ui.md`: their `support.*` names are generic
examples, not pointers into kitchen-sink. No changeset: kitchen-sink is private.
