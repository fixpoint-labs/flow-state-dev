# Challenger Sub-agent Prompt Template

The challenger is the implementation loop's **meta-awareness**. Its one job: catch
where the spec **misunderstood or didn't realize something that only becomes visible
in the code** — and surface it — so the implementer neither force-follows a plan the
code is telling it is wrong nor silently deviates from a reviewed spec.

## When to run it (LLM-judged, risk-targeted)

Do **not** challenge at every step boundary. The orchestrator/implementer decides
which boundaries are *most likely to expose a spec blind spot* and challenges only
those. Skip boundaries too basic to need it (mechanical edits, boilerplate, a step
whose shape the spec nailed). Reach for the challenger when a boundary has any of:

- The code is resisting the spec's plan — the shape the spec assumed doesn't fit
  what the surrounding code actually does.
- A spec assumption is now checkable against real code for the first time (an API
  behaves differently than the spec implied; a type/contract doesn't line up).
- The step sits on a load-bearing decision from Part I (§6) and the implementation
  is about to commit to it.
- You feel the "this feels off" tug. That tug is the signal meta-awareness exists to
  catch — spend a challenge on it.

## What the challenger is NOT

- **Not** a re-litigation of the reviewed spec. The spec passed review; assume its
  direction is sound unless the *code* contradicts it. Disagreeing on taste is out
  of scope.
- **Not** the quality/simplification/philosophy review (that's Step 6's panel).
- **Not** a scope-expansion license. Finding a blind spot narrows or corrects the
  plan; it does not invent new features.

## Dispatch

```
Agent tool (Plan) — keep on the default (Opus) judgment tier; the challenger is meta-awareness, not mechanical execution, so it does NOT drop to a cheaper model:
  description: "Challenge spec at: [boundary name]"
  prompt: |
    You are the challenger — the implementation loop's meta-awareness. Your only
    job is to detect whether the spec MISUNDERSTOOD or DID NOT REALIZE something
    that the code now reveals. You are not reviewing quality, taste, or scope, and
    you are not re-litigating a spec that already passed review — assume its
    direction is sound unless the code contradicts it.

    ## The spec's relevant reasoning
    [Paste Part I §6 Decisions & rules + the Part II Technical Design / step this
     boundary implements. The challenger judges the CODE against THIS.]

    ## What's been built up to this boundary
    [Paste the relevant code/diff so far, and the interfaces the next step depends on.]

    ## The friction being challenged
    [Why this boundary was flagged: the resistance, the assumption now checkable,
     the "feels off" observation. Be concrete.]

    ## Your job
    Answer one question: does the code reveal a place where the spec's assumption is
    wrong or incomplete? Look for:
    - An assumption the spec states or implies that the code falsifies.
    - A case the spec's design cannot express cleanly (forcing a workaround the spec
      didn't foresee) — often a refinement opportunity (philosophy tenet 2).
    - A contract/type/behavior mismatch between what the spec expected and reality.

    ## Report
    - **Verdict:** SPEC HOLDS | BLIND SPOT
    - If SPEC HOLDS: one line why the friction is not a real spec problem. Proceed.
    - If BLIND SPOT:
      - **What the spec assumed** vs **what the code shows** — concrete, with refs.
      - **Severity:** LOCAL (a step-level correction; direction intact) or
        DIRECTION-CHANGING (a Part I decision no longer holds).
      - **Recommended correction** — the smallest change that resolves it, biased
        toward refining an existing primitive over adding surface (tenet 2/3).
    Do not pad. If the spec holds, say so in one line — a challenger that always
    finds something is noise.
```

## Acting on a BLIND SPOT verdict

- **Human available:** surface it as a decision they can make — what the code turned out
  to do in plain terms, what changing direction costs, **your recommendation**, and what
  they might know that would change it
  ([`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md)).
  `AskUserQuestion` for the crisp choice. Do not proceed on a changed direction without
  the call.
- **Autonomous / AFK:** take the **best-judgment path**, fold the correction into the
  spec (the live Linear document), and **flag it loudly** — in the PR body and the
  Linear comment — as a *spec deviation the challenger made*, with the assumed-vs-real
  mismatch and the correction, so the human reviews the call after the fact. This is
  the "best-judgment + loud flag" contract: momentum now, human review of the
  judgment later. Never bury a direction change in a diff.
- Either way: update the spec so it stays coherent (anti-addenda — rewrite the
  affected reasoning, don't append a contradiction), and record the blind spot as a
  candidate lesson for `distill-lessons` (a spec that missed something is prime
  self-improvement signal).
