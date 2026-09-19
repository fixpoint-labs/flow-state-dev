# FIX-1407 · W4: work reaches a seat

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Epic · 7 issues · Workforce: Layer 2 Abstraction · Goal 1 — Workforce multi-seat real usage /
architecture cohesion

## Four teams, before and after

| A team that… | Today | After this epic's first cut |
|---|---|---|
| **has work for a team of seats** | Nowhere shared to put it. Dispatched by hand, from code, one seat at a time | It goes on the channel's board. A seat claims it or is assigned it, and runs it |
| **writes one package for a seat** | Two overlapping systems — the seat's prompt file and skills — and no answer to which one a tool belongs in | One answer: **one package format, written in Markdown**, scoped to instructions and tools, with two attachment modes. A team writes one without an engineer |
| **asks what seats and channels exist** | Opaque strings. `engineering.*` cannot expand, and a seat cannot find another seat's DM | A declared roster read from the tree, plus a live org resource for what is actually open |
| **hands work from one seat to another** | Invents an ambient transcript dump, or a second runtime | A brief, a linked session bound to its parent for life, and parent history only by opt-in tools |

**Why now.** W3 made a Workforce *describable*. Nothing yet says how **work reaches** one of those
declared seats: no shared place to file it, no runtime answer to "which seats exist", and three
unreconciled meanings of *assign*. W3 proved a seat is described; W4 proves a seat is given work.

## What's in the box

![The W4 first cut in three bands: what this epic builds, what the app composes in, and — below a fence — what the set refuses to build. The figure's aria-label carries every item.](figures/end-state.svg)

The **exit gate is the top row and only the top row** ([D1](DECISIONS.md#d1)). The strip under it is
phase-2 *inside* W4 — named so nobody reads it as refused, and nothing on it holds the wrap
([D6](DECISIONS.md#d6)). The bottom strip is what the set refuses to build, named out rather than
forgotten.

## The set · as of 2026-09-19

The live table. Refreshed on the epic PR as issues move; the plan and the figures point here, and
Linear mirrors it ([ER-16](BUSINESS-RULES.md)). **A closed spec PR is review history, not the
document:** read the spec branch's head, or the Linear document on the issue.

| Issue | What it delivers | Why the set needs it | Status |
|---|---|---|---|
| FIX-1408 | Dispatch / session policy: sub-agent is same-session background, worker assign is a roster seat in a **linked** session, `parentSessionId` at mint, history by opt-in tools | The wire everything else routes over | **Done** · 2026-09-18 · no impl PR ([below](#a-note-on-fix-1408)) |
| FIX-1394 | **One package format as a Markdown file**, scoped to instructions and tools, two attachment modes, and **not disk-only** ([ER-2](BUSINESS-RULES.md)). POC-first | Half the epic's title. Two overlapping surfaces grow board and tool sugar twice until this settles | **Done by decision** · 2026-09-19 · the **ratify is the deliverable** and it is recorded — both forks [decided](DECISIONS.md#decided-in-review), [authorship](DECISIONS.md#authorship-answer) and [documents](DECISIONS.md#documents-answer). Matrix [#1921](https://github.com/fixpoint-labs/flow-state-dev/pull/1921) stays open and never merges; the **build is [FIX-1459](#related-not-children), outside the set** |
| FIX-1405 | Inventory in two layers: a declared roster composed from the existing readers, and the live org resource ChannelFlow updates | The epic's third promise in its own right — *which seats and channels exist* — and what `team.*` addressing calls later ([ER-7](BUSINESS-RULES.md)). It does **not** gate the boards | **Done** · 2026-09-19 · PR-A [#1920](https://github.com/fixpoint-labs/flow-state-dev/pull/1920), S4 [#1923](https://github.com/fixpoint-labs/flow-state-dev/pull/1923) and S5–S7 [#1928](https://github.com/fixpoint-labs/flow-state-dev/pull/1928) all **merged** — terminal by merge |
| FIX-1385 | A channel holding `0..N` TaskCollections; channel actions and `taskTools` as two doors on one surface. Plus the PR-5 name check over its own diff ([ER-19](BUSINESS-RULES.md)) | **The exit gate's surface** — the board in "channel/org board → seat runs" | **Done** · 2026-09-19 · [#1922](https://github.com/fixpoint-labs/flow-state-dev/pull/1922) **merged** — one full-scope PR, not the spec's four ([the seam it discharged](PLAN.md#coordination-seams-to-watch)) |
| FIX-1430 | Manager-queue lab: a coordinator seat owns a channel board, assigns to linked seats, shows queue state as **views** over existing task status | The **proof** of the exit gate, and the owner of [ER-20](BUSINESS-RULES.md) | **Done** · 2026-09-19 · [#1929](https://github.com/fixpoint-labs/flow-state-dev/pull/1929) **merged**, and **the gate it exists to run [has passed](#er-20-passed)** — three runs, controls red |
| [FIX-1381](https://linear.app/fixpoint-labs/issue/FIX-1381) | **Seat resource allowlist** — thin seat/kind refs by `ro`/`rw`. The ship ticket for D-11 Ask 1 | Nothing today can control which resources a worker or skill reaches: `resourcesFromDocs` hard-codes `scope: "org"` and `workerConfigSchema` admits only `instructions`, `teamInstructions`, `seatSkills`. **Pulled in by the owner** ([below](#the-sixth-child-pulled-in)) | **In spec review** · spec PR [#1935](https://github.com/fixpoint-labs/flow-state-dev/pull/1935) open on `spec/FIX-1381` · **the spec gate is with the owner and unanswered — nothing here is approved** |
| [FIX-1451](https://linear.app/fixpoint-labs/issue/FIX-1451) | **Skill `allowed-tools` promises a grant it does not make** — the honesty fix on the seat's tool surface | A seat's package is half of this epic's title, and a promise the loader does not keep is the package lying about what a seat can reach. Parented by the owner as a *soft encounter under package cohesion*, explicitly **not a ship-gate on FIX-1394** ([below](#the-seventh-child)) | **In PR review** · a `Bug`, so [**no spec**](#the-seventh-child) — the PR is the review surface · fix PR [#1936](https://github.com/fixpoint-labs/flow-state-dev/pull/1936) open on `fix/FIX-1451-allowed-tools-honesty`, 10 files |

**Five of seven children are complete; two are open.** FIX-1385, FIX-1405 and FIX-1430 merged to
`main` on 2026-09-19, and two are done by decision rather than as code — FIX-1408, whose deliverable
was the dispatch policy, and **FIX-1394, whose deliverable was the ratify** ([the build is downstream](#related-not-children)).
Open: **FIX-1381** at its spec and **FIX-1451** at its fix. Both joined the set today — one pulled
in, one confirmed as having been a child all along.

**The thing this set exists to prove has now been observed** — [ER-20 passed](#er-20-passed), three
runs, with both controls red on the same path. That was the one term no amount of work could
substitute for, and it is met. **It is still not a wrap:** the other term is every child terminal,
and two are not. What is left is two pull requests, which is a different kind of obstacle from the
one that stood here this morning.

<a name="er-20-passed"></a>
<a name="er-20-has-not-run"></a>
**[ER-20](BUSINESS-RULES.md) PASSED on 2026-09-19 — the row that read `NOT RUN` all week now reads
PASS.** The gate is
`goals/manager-queue-lab/it-routes-a-queue-to-the-seats-their-files-name`, run at the default
`GOAL_FILER=model` on `vercel/openai/gpt-5.4-mini`, against commit `e6ccb22` of `main`. **Three
consecutive runs passed.** A coordinator seat whose own file declares `tools: []` chose the desks
and filed four rows through the eight task tools its kind composes; **every row ran on the seat
whose own file answers for that desk**, proved by the outbox rather than by the board's own report.
The waiting row was neither re-routed nor dropped, and a row filed for nobody settled `errored`,
named, and ran nowhere.

**Both controls went red, each at its own leg and nowhere else** — `repointed-map` produced exactly
three leg-(c) identity failures with every row still running and completing, so only the
association moved; `duplicate-filing` produced exactly the two leg-(b) arms and nothing else. **Both
ran on the model path**, which is what makes this row worth more than the scripted control logged on
[#1929](https://github.com/fixpoint-labs/flow-state-dev/pull/1929) — and it is the first check in
this epic whose negative control was demonstrated on the same path as its pass
([why that matters](BUSINESS-RULES.md)). The environment blocker is gone: the project was pointed at
the FSD environment and a thread ran it there.

**This does not wrap the epic, and nothing here should be read as it doing so.** ER-20 was one of
two wrap terms; the other is every child terminal, and **two children are still open** —
[FIX-1381](#the-sixth-child-pulled-in)'s spec, with you on
[#1935](https://github.com/fixpoint-labs/flow-state-dev/pull/1935), and
[FIX-1451](#the-seventh-child)'s fix on
[#1936](https://github.com/fixpoint-labs/flow-state-dev/pull/1936). Neither is merged. What changed
is the *kind* of thing standing in the way: for a week it was a fact nobody had observed, and now it
is two pull requests.

<a name="the-sixth-child-pulled-in"></a>
**The sixth child, and what it cost.** [FIX-1381](https://linear.app/fixpoint-labs/issue/FIX-1381)
joined the set at the owner's own word — *"pull it in"*, 2026-09-19 16:01, answering whether to take
it into the epic's tail or leave it in backlog. It arrived from his own question earlier that day,
whether resource access inside workers and skills could be controlled yet. It cannot: `resourcesFromDocs`
hard-codes `scope: "org"` (`packages/workforce/src/resources-from-docs.ts:80`), `workerConfigSchema`
admits only `instructions`, `teamInstructions` and `seatSkills`
(`packages/workforce/src/worker-config.ts:89`), and no access gate exists anywhere in `workforce/src`
or `orchestration/src`. It needed no new ticket: **FIX-1381 already covered it exactly**, as the ship
ticket for D-11 Ask 1, its own invent-kill naming that `WorkerConfig` gap.

**It moved the wrap out, and that was said before the call was made.** The [wrap](PLAN.md#wrap) now
needed FIX-1381 terminal **as well as** ER-20 passing; ER-20 has since passed, and FIX-1381's spec
is only now in review with no implementation — so it is now one of the two things W4's finish waits
on. The owner made that call with the consequence in
front of him. **It enters cheaper than a cold child:** [D-11 (FIX-1380)](https://linear.app/fixpoint-labs/issue/FIX-1380)
is **Done** and already decides its direction — Ask 1 the thin allowlist, Ask 3 org `ro` automatic
and `rw` by permission — so only its spec is outstanding, not its shape.

**On its Architect fence.** FIX-1381's body fences it against being nested under **W3**. That fence
is about W3 and it still stands; the owner pulled it into **W4**, which the fence does not speak to.
Not a fence broken — a different parent.

**Related, not absorbed.** [FIX-1454](https://linear.app/fixpoint-labs/issue/FIX-1454) is the
scope-*existence* half — resources cannot be scoped to a single seat at all — which is a different
question from which resources a seat may reach.
[FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442), the org-identity security pass, is
adjacent. Neither is folded in here.

<a name="the-seventh-child"></a>
<a name="the-unconfirmed-child"></a>
<a name="the-sixth-child"></a>
**The seventh child: FIX-1451 was never unconfirmed — the epic's note was wrong.**
[FIX-1451](https://linear.app/fixpoint-labs/issue/FIX-1451) (*skill `allowed-tools` promises a grant
it does not make*) carries `parentId: FIX-1407`, a `## Parent` section naming this epic — *"soft
encounter under package cohesion, not a ship-gate on FIX-1394"* — and Architect guidance reading
*"ship-able honesty fix under FIX-1407; do not nest under FIX-1359"*. Filed by the owner at 12:58 on
2026-09-19. **The parenting is deliberate and documented.** The epic carried a standing note saying
to clear it; that note was wrong and the write was never made, which is the only reason the mistake
cost nothing.

**It is a `Bug`, so it skips the spec** and enters at implementation with its PR as the review
surface ([ER-17](BUSINESS-RULES.md)) — there is no spec gate to wait for. That surface now exists:
[#1936](https://github.com/fixpoint-labs/flow-state-dev/pull/1936) on
`fix/FIX-1451-allowed-tools-honesty`. **It holds the wrap like any child**, and with
[ER-20 met](#er-20-passed) the wrap's tail is now just it and FIX-1381.

**Worth naming, because it is this epic's own recurring defect in miniature:** a remembered decision
about set membership, contradicted by the ticket, caught only by reading the ticket before acting on
the memory. That is twice in one day — [FIX-817](#related-not-children) went the other way, out of a
set the memory had it in.

<a name="related-not-children"></a>
**Related, not children.** [FIX-817](https://linear.app/fixpoint-labs/issue/FIX-817) (catalog
manifests) and [FIX-1415](https://linear.app/fixpoint-labs/issue/FIX-1415) (channel-admin verbs) are
real work in the same area the epic's promise does not need. Both **keep their FIX-1405 dependency**
and still obey this set's rules: FIX-817 waits on FIX-1405's **approved** spec
([ER-23](BUSINESS-RULES.md)), and neither may re-decide [ER-3](BUSINESS-RULES.md).

**And the format's build is downstream, not inside.**
[FIX-1459](https://linear.app/fixpoint-labs/issue/FIX-1459) — *ship `PACKAGE.md`, the ratified
worker-package format* — is FIX-1394's ship ticket, **re-homed to related-not-child** on
2026-09-19. W4's objective is the exploration and the decisions it produced; building the ratified
format is downstream of that objective, and parenting it would stop this epic wrapping until a
fresh multi-week feature landed. **So the format is ratified inside W4 and shipped outside it** —
said plainly here because a later reader could otherwise conclude it shipped in this epic. It holds
no wrap; [ER-14](BUSINESS-RULES.md) still fences it when it is picked up.

<a name="a-note-on-fix-1408"></a>
**A note on FIX-1408.** Done with no implementation PR: what shipped is the **decision**
([D4](DECISIONS.md#d4)). Of its five open walls, **one** is evidenced by FIX-1394's POC, **one**
closed on FIX-1430's evidence ([drain width is 1](DECISIONS.md#drain-width)), and **three** are
parked in [Open](DECISIONS.md#open) ([ER-15](BUSINESS-RULES.md)).

## How the issues flow into each other

```mermaid
flowchart LR
  T377["FIX-1377 · TEAM.md · W3, landed"] -.->|"the team layer a package composes onto"| PK
  T416["FIX-1416 · tools fence + blocks scan · W3, landed"] -.->|"what a seat may call"| PK
  DP["FIX-1408 · dispatch / session policy"] -->|"the wire: parentSessionId, opt-in history"| BD
  DP --> PK["FIX-1394 · package cohesion"]
  INV["FIX-1405 · runtime inventory"] -.->|"read if it has landed — not a wait"| BD["FIX-1385 · channel boards"]
  BD -->|"the exit gate's surface"| LAB["FIX-1430 · manager-queue lab · the proof"]
  PK -.->|"a fence on what the lab may author — not an input"| LAB
  D11["FIX-1380 · D-11 · done"] -.->|"the settled direction: thin allowlist, org ro/rw"| ACL["FIX-1381 · seat resource allowlist"]
  T416 -.->|"the fence whose promise the bug breaks — not a wait"| HON["FIX-1451 · allowed-tools honesty · bug"]
  HON -.->|"soft encounter — explicitly not a ship-gate"| PK
  subgraph REL ["related, not in the set — consume it, do not hold its wrap"]
    CAT["FIX-817 · catalog manifests"]
    ADM["FIX-1415 · channel-admin"]
  end
  INV -->|"approved reader contract first, ER-23"| CAT
  INV -.->|"invite and find"| ADM
  T416 -.-> ADM
  classDef done stroke-width:2px
  class DP,BD,INV,LAB,D11 done
```

A **solid** edge blocks; a **dashed** edge does not, and its label says why — **landed code** to
write against ([ER-18](BUSINESS-RULES.md)), a **fence** the child holds itself to
([the proof](#what-the-proof-consumes)), or a surface read **if it has landed**. A heavy border is
done. The two in the box are [related, not children](#related-not-children).

**Exactly one edge inside the set blocks, and it is discharged** — FIX-1385's implementation before
FIX-1430. FIX-1385 merged, so the proof's one prerequisite exists and its build ran. The inventory
does **not** gate the boards: FIX-1385's spec names the declared roster only as an optional read,
and its BR-7 carries the caller's `assignee` verbatim rather than resolving a seat
([ER-5](BUSINESS-RULES.md)).

<a name="what-the-proof-consumes"></a>
**The proof consumes no package work — not the implementation, and not the contract either.**
FIX-1430's seats run on surfaces already on `main` at `d8e4c99` that FIX-1394 does not change, and
the lab authors no package shape at all, so it stayed compatible with every answer FIX-1394 could
reach — including the one it reached. [ER-2](BUSINESS-RULES.md) still binds it as a **fence**: no
shape the ratified format would contradict. Binding the proof to a shipped package, or to a ratify,
would hang the exit gate on work it does not need — the unreachable gate [D1](DECISIONS.md#d1)
exists to prevent.

## What stays as it is

- **Collab RC ([FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341))** — parked. FIX-1415
  shapes a capability surface; it does not reopen Collab.
- **The W3 floor ([FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351))** — soft-*after* for
  ship, never a parent ([D2](DECISIONS.md#d2)).
- **Session substrate ([FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440))** — linked
  dispatch does not re-legitimize nested sessions as a work hierarchy ([D4](DECISIONS.md#d4)).
- **The OOTB agent kind ([FIX-1359](https://linear.app/fixpoint-labs/issue/FIX-1359))** — shipped.
  Package cohesion flags drift against it; it is not redesigned from zero.
- **The board's claim system** — `assignee` stays optional, `TaskStatus` does not grow
  ([ER-11](BUSINESS-RULES.md)).
- **`goals/devforce-lab/` ([FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426))** — the
  coding seam only; it does not grow into FIX-1430's showcase.

## Signed off · 2026-09-19

The owner ratified all three items of this section's ask, each with the recommendation it carried.
What each one killed is in the card behind it.

1. **[D1](DECISIONS.md#d1) · The exit gate is channel/org board → seat runs / assign team seats.**
   The nested cascade is phase-2 inside W4.
2. **[D6](DECISIONS.md#d6) · The set was five**, FIX-1430 adopted as the proof, which gives
   [ER-20](BUSINESS-RULES.md) its owner; FIX-817 / FIX-1415 re-homed as
   [related-not-child](#related-not-children), dependency preserved. **[Extended to six on
   2026-09-19](DECISIONS.md#d6)** by the owner, pulling in FIX-1381.
3. **[D2](DECISIONS.md#d2) · W4 *ship* PRs are soft-after W3**, as written: the fence lifts when
   every W3 child that carries an implementation is merged to main.

Also approved: **the public export of the compose helper on `@flow-state-dev/workforce`**
([D5](DECISIONS.md#d5)). **Since the gate, both of FIX-1394's ratify forks are answered.** *[Who
authors a package](DECISIONS.md#authorship-answer)* — the Markdown file, on your *"your
recommendation is fine"* at 13:22 — and **not disk-only**, because the direction you gave with it is
that packages will eventually be LLM-authored and stored as a resource rather than saved to disk.
And *[are documents in v1](DECISIONS.md#documents-answer)* — **all documents org-scoped for now**, a
seat's document being simply a resource under that seat on the org, with per-resource
configurability arriving later on **resource templates**, which do not exist yet. Both bind through
[ER-2](BUSINESS-RULES.md), and the ratify is unblocked.

**The gate is met.** [ER-20 passed](#er-20-passed) on 2026-09-19 — three runs on the model path,
both controls red at their own legs. The inference key that was the whole of what it waited for
arrived when the project was pointed at the FSD environment. **Behind the gate, the wrap now waits
on two open children** — [FIX-1381](#the-sixth-child-pulled-in)'s spec, which is with you on
[#1935](https://github.com/fixpoint-labs/flow-state-dev/pull/1935), and
[FIX-1451](#the-seventh-child)'s fix on
[#1936](https://github.com/fixpoint-labs/flow-state-dev/pull/1936). Both are open, neither is
merged, and **W4 does not wrap until they are**.

**Settled since the last refresh, and it was the epic that had it wrong:** **FIX-1451 is a child**,
parented deliberately and documented as such on the ticket ([above](#the-seventh-child)) — the
epic's standing note to clear it was mistaken, and no write was ever made on it.

**Open with you, blocking nothing today:** a **[pending re-gate on
ER-14](DECISIONS.md#er-14-re-gate)** — you merged #1928 through the fence, which settles that PR but
says nothing about the rule; narrowing it reopens what you ratified as item 3 above, so only you can
do it. **With the epic:** FIX-1408's three remaining session-policy walls
([Open](DECISIONS.md#open)).
