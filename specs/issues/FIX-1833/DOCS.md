# FIX-1833 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Reader-facing prose for each destination. Implementation reconciles it against the shipped
behaviour, then publishes it through `docs-writer` and `docs-editor`. Unchanged material is left
out. No new page: the floor is one option of best fit, so it extends the page that explains best
fit.

Voice checks most at risk here: introduce "confidence" as the number the model reports, not a
score we compute; no issue numbers under `apps/docs/`; few em-dashes; don't call the floor
"powerful" or "smart".

## UPDATE · `apps/docs/docs/workforce/coordinators.md` · "Setting one up", the key table

Add a row after `fallback`:

| Key | What it sets |
| --- | --- |
| `minConfidence` | Under `best-fit`, the lowest confidence at which a delegate pick is used, from `0` to `1`. Left out, any pick is used. See [When best fit isn't sure](#when-best-fit-isnt-sure). |

And extend the refusals sentence below the second table: "…a `fallback:` that isn't one of its
`delegates:`, a `minConfidence:` outside 0 to 1 or on a coordinator that doesn't route by
`best-fit`, or a delegate named twice."

## UPDATE · `coordinators.md` · "Setting one up", after the first example

Add: "Because `help` has a description, best fit can also pick `help` itself, for a question
that is the desk's own rather than a specialist's. [When best fit isn't sure](#when-best-fit-isnt-sure)
explains how."

## UPDATE · `coordinators.md` · the `defineCoordinatorFlow` table, `routeModel` row

| Option | What it does |
| --- | --- |
| `routeModel` | The model behind `best-fit`'s evaluator call: a model id your resolver knows, or an evaluation model. Required, even when no coordinator routes by best fit. Use `typesafe-ai/jev` if any coordinator sets `minConfidence:`: it reports how sure it is, and the other evaluation models don't. |

## UPDATE · `coordinators.md` · "Choosing how it routes"

Replace the `best-fit` row:

| `routing:` | Who gets a post |
| --- | --- |
| `best-fit` | One evaluator call, reading the post with the conversation's recent lines, picks who takes it: one of the delegates, by its note or else its description, or the coordinator itself, by its own description. A delegate with neither isn't offered. While a delegate is still working your last post, your next one goes to it too, with no call. |

(Keep whatever else the recent-lines change has added to this row by then; only the choice of who can be picked is this operation's.)

Replace the paragraph that starts "Under `best-fit`, a post the call can't place…" with:

### When best fit isn't sure

Best fit asks its evaluation model one question: who should take this post? The choices are the
delegates and, when the coordinator has a `description:`, the coordinator itself. Picking the
coordinator means the post is the coordinator's own job, so its own turn takes it, as under
`judgment`. That is how a coordinator that routes plain requests straight to a delegate still
answers "who works here?" or hires someone itself. Write its description to say what it does
itself:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
description: The person's one point of contact. Hires and fires workers, starts projects, and answers questions about the team.
flow: coordinator
routing: best-fit
minConfidence: 0.7
delegates: [eng.em, eng.coder]
---
```

Some evaluation models also report a confidence with each answer, a number from 0 to 1 for how
sure they are. Jev, `typesafe-ai/jev` through Vercel's AI Gateway, does
([Evaluation models](../fundamentals/models.md#evaluation-models)). Set `minConfidence:` and a
delegate pick below it isn't used. Picking the coordinator is used at any confidence.

Best fit can't place a post when the call fails, answers with something that isn't a choice, has
nobody to pick from, picks a delegate below `minConfidence:`, or reports no confidence while
`minConfidence:` is set. Such a post goes to the `fallback:` delegate. With no fallback, or one
that can't be reached, the coordinator's own turn takes it. If that turn fails too, nobody takes
the post, and the conversation says so:

```text
Nobody took this post: best fit couldn't place it, and the coordinator's own turn failed: <error>.
```

A few things to know before you set a floor:

- **Only models that report confidence can pass it.** On a model that reports none, every
  delegate pick falls below the floor, and every post goes to the fallback or the coordinator's
  own turn. Leave `minConfidence:` out on those models.
- **There's no default.** Without `minConfidence:`, best fit uses any delegate pick, however
  unsure. We picked 0.7 for a chief of staff after asking Jev about requests meant for it and for
  its delegates: the misplaced ones came back at 0.2 or lower, and the clear ones at 0.76 or
  higher. Check your own coordinator's requests before you copy the number.
- **A request that is still with a delegate skips all of this.** Your next post goes to the
  delegate working your last one, with no call, until it answers. A request meant for the
  coordinator, sent in that window, goes to that delegate too.

`round-robin` and `everyone` say the same when they find no delegate to reach: `Nobody took this post: no delegate in this conversation can be reached.`

## UPDATE · `coordinators.md` · "What it records", the field table

Change the `by` row's `judgment` wording, and add a row after `none`:

| Field | What it holds |
| --- | --- |
| `by` | How the delegates were found: `judgment` (the coordinator's own turn, chosen by `routing: judgment` or handed the post by best fit), `held` (best fit, still on your last post), `evaluated` (best fit's call), `fallback`, `round-robin`, `everyone`, or `unplaced` (nobody took it). |
| `fit` | When best fit didn't deliver to its pick and the fallback or the coordinator's own turn took the post, why: `reason` is `coordinator` (the call picked the coordinator), `below-floor`, `no-confidence`, `failed`, `not-a-choice` or `no-delegates`, with the `choice`, its `confidence` and the `minConfidence` in force where there are some. |

An example to show beside it:

```json
{
  "postId": "req_…",
  "round": 0,
  "policy": "best-fit",
  "by": "judgment",
  "delegates": [],
  "fit": { "reason": "below-floor", "choice": "eng.em", "confidence": 0.36, "minConfidence": 0.7 }
}
```

## UPDATE · `coordinators.md` · "Letting delegates answer each other", "What it costs"

Replace the last sentence: "`best-fit` adds at most one evaluator call per round, plus a
coordinator turn for each post it picks the coordinator for or can't place, when no fallback
takes it."

## UPDATE · `apps/docs/docs/workforce/chief-of-staff.md` · the opening

Replace the first paragraph's second sentence: "Set up as below, it's a
[coordinator](./coordinators.md) that routes by judgment: it decides who gets each thing you ask,
and it can answer you itself. To send plain requests straight to the delegate that does them,
route it by best fit instead, as [Sending plain requests straight to a delegate](#sending-plain-requests-straight-to-a-delegate) shows."

## UPDATE · `chief-of-staff.md` · new section, after "Adding one", before "Starting projects"

### Sending plain requests straight to a delegate

Routed by judgment, the chief of staff runs a full model turn on everything you ask, even "file
this feature for the storefront", which obviously belongs to one delegate. That turn reads its
delegates, hands the request on, and writes a line before the delegate answers.

Route it by best fit, with Jev as the coordinator flow's `routeModel`, and one evaluator call
decides instead. A plain request goes straight to the delegate, whose answer is the first thing
you see. Hiring, firing, starting a project and questions about your team still reach the chief
of staff's own turn, because best fit can pick the chief of staff itself:

```diff
  ---
- description: Your one point of contact, and the one worker that changes your roster.
+ description: Your one point of contact. Hires and fires workers, starts projects, and answers questions about your team.
  flow: coordinator
- routing: judgment
+ routing: best-fit
+ minConfidence: 0.7
  delegates: [eng.em, eng.coder]
```

```diff
  const coordinator = defineCoordinatorFlow({
    installation,
    delegateFlows: [agent, emFlow],
-   routeModel: "openai/gpt-5.4-mini",
+   routeModel: "typesafe-ai/jev",
```

The description is what best fit picks the chief of staff by, so name its jobs there. Anything
Jev isn't sure of, below `minConfidence:`, also goes to its turn, which can still hand it on. The
trade: a post that turns out to be the chief of staff's own job costs one evaluator call before
the turn, and a request sent while a delegate is still working your last one goes to that
delegate. [When best fit isn't sure](./coordinators.md#when-best-fit-isnt-sure) has the details.

## UPDATE · `chief-of-staff.md` · after the flow example, the `routeModel` sentence

Replace "`routeModel` is required even though the chief of staff routes by judgment; only a
coordinator on `best-fit` calls it." with "`routeModel` is required even when the chief of staff
routes by judgment; only a coordinator on `best-fit` calls it. Set it to `typesafe-ai/jev` to
route by best fit with a floor, as the next section shows."

## UPDATE · `apps/docs/docs/fundamentals/models.md` · "Evaluation models", after "We recommend Jev through the gateway…"

Add: "Workforce coordinators that route by best fit read it the same way: their
`minConfidence:` sends a doubtful pick to the coordinator's own turn
([Coordinators](../workforce/coordinators.md#when-best-fit-isnt-sure))."

## UPDATE · `packages/workforce/README.md` · "Coordinators"

In the `WORKER.md` example, after `fallback:`:

```md
minConfidence: 0.7       # best-fit only: a delegate pick below this goes to the fallback, else the turn
```

The `routeModel` comment becomes `// best fit's one evaluator call; typesafe-ai/jev reports confidence`.

Replace the **Routing** bullet's best-fit sentence: "`best-fit` sends a follow-up to the delegate
still working the person's last post, else makes one evaluator call over each delegate's note or
description and the coordinator's own description. A pick of the coordinator runs its judgment
turn. A delegate pick below `minConfidence:`, or with no confidence while it is set, a failed
call, or no one to pick goes to the fallback, else the judgment turn. If that turn fails too,
nobody takes the post, and the conversation says so." Add to the record's field list: "`fit`: why
best fit handed the post to the judgment turn."

## UPDATE · `packages/shift-manager/README.md` · the DevTeam chief of staff example

The example's front matter becomes `routing: best-fit` with `minConfidence: 0.7`, and the
sentence after it gains: "It routes by best fit with Jev, so a plain request goes straight to the
delegate that does it, and hiring, firing, projects and questions about the team reach its own
turn."

If BR-24 holds, the memory paragraph ("Its chief of staff has memory…") gains: "A request
best fit sends straight to a delegate runs no chief-of-staff turn, so nothing of it is recorded."

## Checked, no change · `coordinators.md` · "What it won't do"

Its five bullets stay true: best fit still reads a delegate's note or description, and nothing
here hands a post to another user's worker.

## Publication ownership

This issue publishes every operation above. The epic's terminology sweep and FIX-1792's page
moves may touch the same pages; reconcile with whichever lands first, without duplicating their
prose.
