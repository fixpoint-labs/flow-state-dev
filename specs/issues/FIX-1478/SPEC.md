# FIX-1478 · One recipe per job, on screen

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Improvement · `apps/kitchen-sink` · small · 1 PR · epic [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **opens the reference app to learn how a team gets work done** | Finds a menu offering six ways to do it. Five run inside the one turn and vanish when it ends; one hands work to a team that outlives it. Nothing on screen says which is which | Finds the durable one, and the org's seats and boards beside it. The menu no longer competes with the roster it sits next to |
| **picks the menu entry called *Supervisor*, expecting the roster to light up** | Gets an in-process loop. No seat is involved, nothing appears on a board, and nothing survives the reply. The word means something different two inches away on the same screen | Has no such entry to pick. The only coordination the app shows is the one that actually uses seats and boards |
| **reads the published patterns documentation and wants a live example** | Finds the reference app wired to five of them, so reads the app instead of the docs | Reads the docs, which carry their own runnable examples. One pattern keeps its live example here, because that is the one the docs point at |
| **has the response-quality annotation switched on** | Sees a bias annotation after an answer when the score clears the threshold | Unchanged, exactly. This is the one surface that keeps its pattern, deliberately |
| **audits what the reference app depends on** | Sees a coordination-patterns dependency and no statement of why | Still sees it — and a written reason naming the single surface that needs it. It is a deliberate keep, not a leftover |

The reference app's job is to teach the one way we would tell someone to do a thing. It currently
teaches two ways to get work done by several agents, side by side, using the same word — *worker* —
for two things with different lifetimes. That is the cost being paid here; the code removed is a
consequence, not the point.

## What changes

![Five kitchen-sink surfaces that import the coordination-patterns package, placed either side of a fence between work a team does and work one request does. Four fall on the team side and are shed; one, the response audit, falls on the one-request side and is kept, because no seat, board or channel audits a response. Captions record the arithmetic: four of five have an honest team path, so the epic's collapse trigger does not fire, and one keep-note remains, so the dependency stays](figures/audit.svg)

The fence is the audit. A surface is shed only when a team already does that job today — never by
wrapping a seat in a pattern factory so it fits. Four cross; one does not, and says why.

**The menu above the prompt, as a person sees it:**

```diff
  Auto
  Default
- Plan & Execute
- Supervisor
- Routed Specialists
- Evented Actors
- Moderated Debate
  Background Work
```

**And the app's declared dependencies:**

```diff
    "@flow-state-dev/orchestration": "workspace:*",
    "@flow-state-dev/patterns": "workspace:*",
+   // kept for the response audit only — see the keep-note
```

## What stays as it is

- **The coordination-patterns package**, its API and its published documentation. This is a
  consumer dropping most of its uses, not a deprecation. Every pattern shed here stays supported
  and stays documented.
- **The response-quality audit.** Same trigger, same threshold, same annotation. It is the one
  keep, and the published docs already point readers at it.
- **The durable hand-off entry**, which files work to a team that outlives the turn. It is the
  recipe this issue is clearing room for, and it does not change.
- **`Auto`.** It still resolves a request to a style; it simply has fewer to choose between.
- **The four conversation modes** — ask, build, interview, debate. They steer prompts and involve
  no coordination pattern, so they are out of scope here ([D3](DECISIONS.md#d3)).
- **Whether the control row survives at all.** That is [FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477)'s
  call. This issue empties what patterns backed; it does not decide what takes the space.

## Sign off

1. **[D1](DECISIONS.md#d1) · The four coordination surfaces are removed, not rebuilt on seats.**
   If wrong: the reference app stops demonstrating in-request composition entirely, and a reader
   who wants it has only the published docs and the benchmark app to learn from.
2. **[D2](DECISIONS.md#d2) · The dependency stays, for one surface, with a written reason.**
   If wrong: the issue's headline — *drop the dependency* — is not met, and anyone measuring this
   work by that sentence will read it as unfinished.
3. **[D3](DECISIONS.md#d3) · Only what a coordination pattern backs comes out.** If wrong: the
   conversation modes survive a pass that the epic's picture shows sweeping them away, and
   whoever expected that has to file it again.

**Open: none.** Number 2 is the one to weigh — it is the one that changes what this issue can
claim to have delivered. The reasoning, what was rejected, and what each locks in is in
[DECISIONS.md](DECISIONS.md). The cases are in [BUSINESS-RULES.md](BUSINESS-RULES.md).
