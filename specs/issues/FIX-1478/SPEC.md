# FIX-1478 · One recipe per job, on screen

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Improvement · `apps/kitchen-sink` · small · 1 PR · epic [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **opens the reference app to learn how work outlives a turn** | Finds a menu offering seven ways to answer. Six run inside the one turn and vanish when it ends; one files the work to a durable board and a child session that outlive it. Nothing on screen says which is which | Finds the durable one, and the org's roster beside it. The menu no longer competes for the reader's attention with the thing the app is there to teach |
| **picks the menu entry called *Supervisor*, expecting the roster to light up** | Gets an in-process loop. No seat is involved, nothing appears on a durable board, and nothing survives the reply. The word *worker* means something different two inches away on the same screen | Has no such entry to pick. The one multi-step recipe left is the one whose work survives the turn |
| **reads the published patterns documentation and wants a live example** | Finds the reference app wired to five of them, so reads the app instead of the docs | Reads the docs, which carry their own runnable examples. One pattern keeps its live example here, because that is the one the docs point at |
| **has the response-quality annotation switched on** | Sees a bias annotation after an answer when the score clears the threshold | Unchanged, exactly. This is the one surface that keeps its pattern, deliberately |
| **audits what the reference app depends on** | Sees a coordination-patterns dependency and no statement of why | Still sees it — and a written reason naming the single surface that needs it. It is a deliberate keep, not a leftover |

The reference app's job is to teach the one way we would tell someone to do a thing. It currently
teaches two ways to get work done by several agents, side by side, using the same word — *worker* —
for two things with different lifetimes. That is the cost being paid here; the code removed is a
consequence, not the point.

### The counts, once

Reviewers have read four and five in different places. These are the numbers, and every other
document uses these words for them.

| | Count | What it means |
|---|---|---|
| **Package imports** | 5 source files | The files matching `from "@flow-state-dev/patterns` under `apps/kitchen-sink` — six import statements, because the router file has two |
| **Pattern-backed routes** | 5 | `supervisor`, `routed-specialists`, `evented-actors` (one pipeline file each) plus `plan-and-execute` and `moderated-debate`, both inlined in `create-router.ts` |
| **Shed files** | 4 | The three pipeline files are deleted; `create-router.ts` survives, minus both imports and both inlined builders |
| **Keep** | 1 | `run/bias-check.ts` |
| **Menu options** | 8 today → 2 after | Six leave: the five pattern-backed routes and `Auto` ([D4](DECISIONS.md#d4)). `Default` and `Background Work` remain |

The **routes** row is the one the epic's collapse trigger counts against, not the files —
whether `moderated-debate` sits in its own file or inside the router changes nothing a
person sees. Three of the five have an honest team path ([Evolution](EVOLUTION.md)).

## What changes

![Five kitchen-sink source files that import the coordination-patterns package, placed either side of a fence between work a team does and work one request does. Four fall on the team side and are shed, carrying five pattern-backed routes between them; three of those routes have an honest team path and two do not. One file, the response audit, falls on the one-request side and is kept, because no seat, board or channel audits a response. Captions record the arithmetic: three of five routes have an honest team path, so the collapse trigger does not fire, by one rather than by two; the two without a path are shed anyway on the vocabulary collision; and one keep-note remains, so the dependency stays](figures/audit.svg)

The fence sorts the routes by whether a team already does that job — never by wrapping a seat in a
pattern factory so it fits. **Three cross. Two do not, and are removed anyway**, because having no
team equivalent is not a reason for the reference app to keep teaching them; it is only a reason
not to claim a migration happened. What makes a surface a *keep* is [D2](DECISIONS.md#d2)'s test —
a job the app still legitimately needs done inside one request — and only the response audit
passes it.

**The menu above the prompt, as a person sees it:**

```diff
- Auto
  Default
- Plan & Execute
- Supervisor
- Routed Specialists
- Evented Actors
- Moderated Debate
  Background Work
```

`Auto` goes with them: once the five are gone it can only ever resolve to `Default`, and it pays
for a model call to get there ([D4](DECISIONS.md#d4)).

**The app's declared dependencies do not change.** `@flow-state-dev/patterns` stays, for the
response audit alone; the reason is written in the pull request, not in the manifest
([D2](DECISIONS.md#d2), [PLAN S9](PLAN.md)).

## What stays as it is

- **The coordination-patterns package**, its API and its published documentation. This is a
  consumer dropping most of its uses, not a deprecation. Every pattern shed here stays supported
  and stays documented.
- **The response-quality audit.** Same trigger, same threshold, same annotation. It is the one
  keep, and the published docs already point readers at it.
- **The durable hand-off entry**, which files work to a board and a child session that outlive
  the turn. It is the recipe this issue is clearing room for, and it does not change. It is not
  a Workforce hand-off and this spec no longer says it is — see [Decisions → Open / settled](DECISIONS.md#open--settled).
- **The four conversation modes** — ask, build, interview, debate. They steer prompts and involve
  no coordination pattern, so they are out of scope here ([D3](DECISIONS.md#d3)).
- **Everything that draws a past turn.** The renderers for containers and board items —
  `routed-specialists.tsx`, `debate.tsx`, `task-plan.tsx` — stay. Old threads keep rendering;
  a person scrolling back sees what they saw before ([D4](DECISIONS.md#d4)).
- **Whether the control row survives at all.** That is [FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477)'s
  call. This issue empties what patterns backed; it does not decide what takes the space.

## Sign off

1. **[D1](DECISIONS.md#d1) · All five coordination routes are removed, including the two a team
   cannot do today.** If wrong: the reference app stops demonstrating in-request composition
   entirely, and a reader who wants it has only the published docs and the benchmark app. This
   is the item the recount moved — the first draft said four of five routes had a team
   equivalent; three do, and *two are removed with nothing offered in their place*.
2. **[D4](DECISIONS.md#d4) · `Auto` goes, and the intent classifier with it.** If wrong: the app
   loses its only worked example of classifier-based routing, and a person who used Auto has to
   pick a style by hand. Kept as-is it would be a control that bills a model call to return the
   answer the next entry down already gives.
3. **[D2](DECISIONS.md#d2) · The dependency stays, for one surface, with a written reason.**
   If wrong: the issue's headline — *drop the dependency* — is not met, and anyone measuring this
   work by that sentence will read it as unfinished.
4. **[D3](DECISIONS.md#d3) · Only what a coordination pattern backs comes out.** If wrong: the
   conversation modes survive a pass that the epic's picture shows sweeping them away, and
   whoever expected that has to file it again.

**Open: none — but read 1 and 2 before the rest.** Number 1 is the one the review changed: the
epic's collapse trigger counts routes with an honest team path, and the true count is three, not
four. Three clears the bar, so this issue stays separate rather than folding into
[FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477) — by one route, not by two. Number 2
is a menu entry disappearing that nothing in the original scope mentioned. The reasoning, what
was rejected, and what each locks in is in [DECISIONS.md](DECISIONS.md). The cases are in
[BUSINESS-RULES.md](BUSINESS-RULES.md).
