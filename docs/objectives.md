# Project Objectives

## The objective

**From a framework proved by synthetic tests, to one proved by real apps running on real
models — by `<SET A DATE>`.**

A goal with no finish line can't be finished, and an epic can't be tested against it. So
this one carries all four parts, and every epic's objective gate asks which of them it
serves and how much of the gap it closes.

| | |
|---|---|
| **Winning when** | Every Phase 1 subsystem is exercised end to end by a goal check driving the real path from a real app, and Wave 1.n (cross-package validation) is closed |
| **Lead measure** | **Goals passing over goals *defined*** — read off one `pnpm goal:all` run. Not packages shipped, not waves closed |
| **Now** | Waves 1.a–1.m complete · 1.n open · **34 defined, 33 with a runner** · passing `<RUN goal:all ONCE TO SET>` |
| **Kill line** | If real usage shows the four block kinds don't compose into the workflows apps actually need, Phase 1 isn't unfinished — it's mis-shaped, and what changes is the composition model, not the remaining wave list |

> **Two blanks are yours, not mine.** The date is a business call; the passing count needs one
> `pnpm goal:all` run to establish honestly. Both are left visible rather than guessed — a
> fabricated finish line is worse than an absent one, because it reads as agreed.

**The lead measure is derivable from one `goal:all` run, and that is the point.** An earlier
draft counted *"Phase 1 subsystems covered"*, which sounds better and cannot be computed: no
subsystem inventory exists, and nothing maps 34 capability-shaped goal files onto one. A
measure whose denominator has to be invented gets invented differently every time it is read.

**Read the denominator carefully — it is not the ratio the tool prints.** `goal:all` reports
`X/Y passed` over the goals that **have a runner**, and lists any `goal.md` with no `run.mts`
separately as *unimplemented* without failing the sweep
(`goals/scripts/run-all.mts`). Today that is one goal:
`goals/plan-and-execute/carries-original-data-to-workers`. So the measure is **X / (Y +
unimplemented)**, both numbers from the same run. Taking the printed ratio instead would let
`33/33 passed` read as complete while a defined goal has never proved anything — a goal you
wrote and never wired is not a goal you passed.

**Its honest limitation, stated so nobody has to discover it:** this counts the goals we have
*written*, so it moves when we write a goal as well as when one passes, and a subsystem with
no goal at all is invisible to it. Read it next to "is new work arriving with goal checks?"
— which is exactly the method-not-number discipline `distill-lessons` applies to the
cycle-ledger.

**Why a lead measure and not just the finish line.** *Winning when* is a lag measure: we
learn it at the end, too late to change it. The lead measure is the running read that
predicts it, and it counts passing goal checks rather than merged work because merging is
activity and a passing goal check is evidence. The distinction, and where it came from, is
[`docs/internal/4dx-process.md`](internal/4dx-process.md).

## Goals

### 1. Validate through real usage

Ship working examples and integrations that exercise the framework end-to-end. Synthetic tests aren't enough. The framework needs to handle real workflows with real AI providers to prove it works.

### 2. Differentiate on hard problems

Focus on capabilities that other frameworks handle poorly or not at all:
- Structured multi-block workflows with typed state flow between blocks
- Resumable streaming with sequence-number-based reconnection
- Scoped state management (session, user, project) with CAS consistency
- Block-level retry, rescue routing, and error normalization
- Composable sequencer/router patterns with declarative DSL

### 3. Complete Phase 1 foundation

Finish the remaining wave (1.n cross-package validation) with the same rigor as 1.a–1.m. No shortcuts on the foundation. Every package boundary, type contract, and runtime behavior should be solid before moving to Phase 2.

### 4. Keep the foundation honest

Don't paper over gaps. If something doesn't work well, fix it or document the limitation clearly. The framework's value comes from getting the fundamentals right, not from feature count.

## Non-Goals (for now)

- Production deployment guides or infrastructure tooling
- Plugin/extension ecosystem
- Performance optimization beyond correctness
- Multi-provider abstraction (Vercel AI SDK is the Phase 1 provider)
