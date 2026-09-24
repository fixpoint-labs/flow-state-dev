# FIX-1556 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

What was considered, what was chosen, and what each choice locks in. The epic's decisions
([FIX-1553 D1 to D4](../../epics/FIX-1553/DECISIONS.md)) and the owner's locks are input here, not
reopened. The epic left two walls open for this issue: where the demo lives, and the guide's
path. D1 closes the first; the path is decided below without an ask.

## The tree

```mermaid
flowchart TD
  I["FIX-1556"] --> D1["D1 · the demo is the guide's companion example"]
  D1 -.->|"rejected · an app mid-rebuild"| X1["a kitchen-sink page"]
  I --> D2["D2 · the no-confidence case is its own action"]
  D2 -.->|"rejected · the surprise stays in prose"| X2["Jev only, with a caveat"]
  I --> D3["D3 · the assembled goal fails closed on a missing leg"]
  D3 -.->|"rejected · done on four of six"| X3["pass on the legs that are wired"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · The demo is the guide's companion example, `examples/guides/routing-with-evaluators`, not a kitchen-sink page

| | |
|---|---|
| **Instead of** | A page in the kitchen-sink · or a fixture under `labs/` |
| **Because** | Three guides already ship this way: a guide on the site, and a tested, `fsdev`-runnable package beside it under `examples/guides/` (research team, board lifecycle, custom pattern). It is the smallest surface that already boots, which is what the issue asked for. It depends only on published packages, so "no kitchen-sink-only API" holds by construction and a check can prove it (BR-8). The kitchen-sink is mid-rebuild under FIX-1455 and its chat agent carries the shed thinking-style router; adding a routing demo beside that invites the confusion the owner ruled out. `labs/` is for applications with real data, not teaching snippets (`examples/README.md`) |
| **Locks in** | The kitchen-sink shows no evaluator in this epic. If FIX-1455 wants one later, it copies the example; nothing here has to move. No coordination with FIX-1455 is needed to ship |

**What would change my mind:** the owner wanting the reference app to exercise every block kind
as a standing rule. Then the example still ships, and a kitchen-sink follow-up is filed against
FIX-1455.

<a name="d2"></a>
## D2 · The example runs the same tree on a model with no confidence, as its own action, and it always lands on review

| | |
|---|---|
| **Instead of** | Running the example on Jev only and stating the no-confidence behaviour in the guide's prose |
| **Because** | The epic's hardest sign-off ([epic D2](../../epics/FIX-1553/DECISIONS.md#d2)) is that a `cascadingRouter` tree on the popular providers routes everything to `ambiguous`. That is the behaviour most likely to read as a bug to a newcomer. Seeing it happen, beside the Jev run that routes, teaches it better than a paragraph does. The same action is leg (c)'s second half, so the goal drives it through `fsdev run` rather than a hand-built harness |
| **Locks in** | Running every action needs two credentials: the gateway for Jev, and whatever the adapter model needs. The README and the guide label that action as the no-confidence case up front, so nobody runs it first and concludes the router is broken |

<a name="d3"></a>
## D3 · The assembled goal fails closed: a leg not yet wired reports pending, and pending is not a pass

| | |
|---|---|
| **Instead of** | A goal that passes on whichever legs are wired, and lists the rest as a note |
| **Because** | The epic may only wrap when all six legs hold ([epic ER-15](../../epics/FIX-1553/BUSINESS-RULES.md#the-proof)). Legs (e) and (f) belong to FIX-1557 and FIX-1555, which are not blocking this issue and may land weeks later ([epic PLAN](../../epics/FIX-1553/PLAN.md#what-each-issue-entails)). A goal that says PASS with two legs missing is the same soft-fail the whole epic forbids for routing: missing evidence read as good evidence |
| **Locks in** | The full goal is red from this issue's merge until both siblings wire their legs. This issue's own merge bar is legs (a) to (d), run as a named subset that exits on those legs alone. The epic's lead measure is the count of passing legs, read off the per-leg report, not the exit code |

**What would change my mind:** FIX-1555 being cut. The epic already says its leg then leaves by
amendment, and the goal's leg list shrinks with it rather than staying pending forever.

## Decided, not asked

- **The guide is `apps/docs/guides/routing-with-evaluators.md`**, confirming the epic's proposed
  path. It sits in the Guides sidebar just before *Adding skills to your app*, since its third
  step hands off there.
- **The lab page graduates by rewrite, not copy.** Its lab imports, its "POC / DNM" framing and its
  invent-kill table don't go on a published page (the outsider rule in `docs/contributing/user-docs.md`).
  The kills already live as epic rules ER-9 to ER-12.
- **The guide's prose is drafted in [DOCS.md](DOCS.md)** and published through the `docs-writer`
  then `docs-editor` agents, per `CLAUDE.md`.
- **The example's CI tests use the mock evaluation model FIX-1554 adds to `@flow-state-dev/testing`.**
  No key in CI; the real-model proof is the goal's job.
- **The goal drives the example, not the blocks in isolation.** FIX-1554's own goal already proves
  the block alone; legs (a) and (b) here prove it inside an app someone would copy.
- **Facets and memory get one pointer line each** in the guide, only to pages that exist when it
  publishes. The teach path omits them, as the issue says.
- **No changeset.** The example and `goals/` are private; docs need none (BP-022).
- **The skill catalog in the example is two or three `SKILL.md` folders**, written for the demo,
  not borrowed from the kitchen-sink.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Teach every slice of the lab (facets, memory, index-time search) | The issue scopes the teach to evaluate, one cascade and the activator. The others have owners and their own docs |
| One goal per leg, each owned by its child | Six green goals prove six pieces. The epic's gap is the proof that they work together |
| Reuse FIX-1554's goal for legs (a) and (b) | It runs the block bare. It can't catch an example wired wrong, which is what a reader copies |
| Snippets written for the page, separate from the example | They drift. A page snippet that no test compiles is how a guide teaches an API that changed |
| Hold this issue until facets and memory land, so the goal is green at merge | It would put the cut candidate (FIX-1555) on the critical path, which the epic rejected |

## How it got here

- **Draft** — framed as the epic's teach and proof child; the demo is a guide companion example,
  the no-confidence case is runnable, and the assembled goal fails closed on a missing leg.

**Open: none.**
