# FIX-1589 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Six places change: the kitchen-sink README (the epic's shared text, the parts this issue
owns), the channels guide (one paragraph), the workforce README and the workers-on-disk guide
(the `seatId` contract key), the worker-kind architecture doc, and two file headers. The epic's
[DOCS.md](../../epics/FIX-1592/DOCS.md) owns the README's opening; this issue adds only its
clerk sentence and the `escalations` sentence.

## UPDATE · `apps/kitchen-sink/README.md` · the support team's opening, the clerk sentence

Added to the seat paragraph FIX-1585 publishes, word for word from the epic's draft:

> `support.ada` is a desk clerk: ask it something and a model answers, or, when the note needs
> someone else, files it onto `followups` or `escalations`.

## UPDATE · `apps/kitchen-sink/README.md` · "The support team", the paragraph before the CLI example

Replaces "Each seat is addressed by its own id, so a seat answers on the same route as any
other flow:"

> Each seat is addressed by its own id, so a seat answers on the same route as any other flow.
> The desk clerk's `answer` calls a model, so it needs the same model key the rest of the app
> uses; without one the call fails with the provider's error rather than answering. Its reply
> starts with the desk its `WORKER.md` sets, `[front desk]` for Ada and `[back desk]` for
> Grace, and the rest is the model's.

## UPDATE · `apps/kitchen-sink/README.md` · "Nothing is wired to `escalations`", after the boot line

The epic's sentence, then one on how the clerk gets there:

> The clerk files there when a note needs a person, so this is where you see those rows wait.
> It files through the channel's own `fileTask` action, the same one any flow can call, and
> it declares no board itself, which is why the warning stays.

## UPDATE · `apps/docs/docs/workforce/channels.md` · "Filing and reading rows", after the `fileFollowup` example and its "Both actions take the board's local name" paragraph

> A dispatcher is a block, so it can also be a tool. Hand it to a generator and the model
> decides when to file and onto which board, while your code keeps the parts the model
> shouldn't choose:
>
> ```ts
> const fileOntoDesk = dispatcher({
>   name: "desk-clerk-file",
>   description: "File this onto a board: followups for work a seat runs, escalations for a person.",
>   flowKind: "channel",
>   action: "fileTask",
>   inputSchema: z.object({ board: z.enum(["followups", "escalations"]), goal: z.string() }),
>   session: { id: () => "support.desk" },
>   payload: (input, ctx) => ({ ...input, author: ctx.flow.config.seatId }),
> });
> ```
>
> The model picks the board and writes the goal; the `author` is the seat's own `seatId`, which
> hiring gives every seat, not something the model chooses. The tool's result is the dispatch, not the row: the row is written when the
> channel runs `fileTask`, a moment later. If the channel refuses it, say because the author
> is not a member, the model has already been told the filing was sent, and the refusal is a
> failed request on the channel's session.
>
> The dispatch goes into an existing session by its id, which needs the in-process dispatcher.
> Under an external dispatcher such as BullMQ the dispatch is refused, so catch that and tell
> the model the board is unavailable rather than letting the tool fail.

## UPDATE · `apps/kitchen-sink/README.md` · "The support team", after the model-key sentence

> Filing needs the in-process dispatcher. Run the app with `FSD_BULLMQ_DISPATCH=1` and the
> clerk still answers, but says it cannot file.

## UPDATE · `packages/workforce/README.md` · the admission-contract table (after the `seatPackages?` row) and the imposed-keys paragraph after it

New row:

> | `seatId` | The seat's own id, as the roster's `members:` lists it. Imposed on every record; a block inside the seat reads it as `ctx.flow.config.seatId`, for example to sign what it files or posts. |

In the paragraph that lists what hiring imposes, add "`seatId` always" beside `seatSkills` and
`seatTools`. In the refused-keys sentence (a `WORKER.md` key refused by name, at the loader and
at the hire), in the `declared` row of the record table, in the `workerConfigSchema()` row of
the API table, and in the "Worker cannot be hired" row, add `seatId:` to each list of refused
or declared keys, making six.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · the refused-key lists and "What a record carries"

In the three lists of keys a `WORKER.md` may not declare (the frontmatter section, the loader's
refusals and the hire's refusals), add `seatId:`. In the paragraph on what hiring imposes, add
"`seatId` on every record". After that paragraph:

> Every hired seat knows its own id. It arrives as the `seatId` setting, the same id the
> team's `members:` lists, so a block running inside the seat can sign what it files or posts
> without being told who it is. A worker file can't set it.

## UPDATE · `docs/architecture/workforce-default-worker-kind.md` · the admission-contract row, and "Imposed and never-authored"

The contract row's key list gains `seatId`. In the imposed/never-authored paragraph: `seatId`
is imposed on every record, like `seatSkills` and `seatTools`, and no file may author it, so
five keys are both imposed and never-authored and `instructions` stays the one that is imposed
and authored. The key exists because a seat that files or posts must name itself, and a seat
that cannot is indistinguishable from any other (D3).

## Release note

One `minor` changeset for `@flow-state-dev/workforce`: every hired seat carries its id as
`seatId`, a worker file that sets it is refused, and a hand-written worker-kind schema must
admit it. kitchen-sink is private: no changeset.

## UPDATE · `apps/kitchen-sink/workforce/flows/workers/desk-clerk.ts` · file header

> A custom worker kind: a desk clerk. Its `answer` action asks a model to answer a note, under
> the seat's own instructions, and gives the model one tool, which files the note onto one of
> `support.desk`'s boards through that channel's own `fileTask`. The reply is tagged with the
> desk the seat's `WORKER.md` sets; the rest is the model's. The kind declares no board, so
> filing onto `escalations` does not attend it: nothing drains that board here.

(The existing paragraphs on discovery, `cardinality` and the settings schema stay.)

## UPDATE · `apps/kitchen-sink/workforce/blocks/desk-note.ts` · file header

Replace "The block is reachable two ways…" through the end of that paragraph:

> It returns and says nothing else. It is the tool `support.otto` names in its `WORKER.md`;
> the desk clerk used to run it as its whole answer and no longer does.

## Publication ownership

FIX-1589 publishes these after its goal check passes and its control fails. The README's
opening paragraph stays the epic's: FIX-1585 publishes the seat half, this issue adds the clerk
sentence, FIX-1594 the channel half. No other page changes.
