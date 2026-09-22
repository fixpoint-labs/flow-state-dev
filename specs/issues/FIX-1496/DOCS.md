# FIX-1496 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

## No published-documentation impact, and why

Nothing user-facing changes. This issue adds no public API, no configuration, no observable
framework behaviour and no new concept a reader would search for: every changed path is inside
`goals/devforce-lab/`, which is retained evidence rather than a shipped surface, and no package
under `packages/` is touched (enforced as [BR-16](BUSINESS-RULES.md), checked by `V9`).

Checked rather than assumed, against the surfaces the docs-scoping heuristics name:

| Surface | Verdict |
|---|---|
| `apps/docs/docs/` (reference) | No change. No new primitive, no altered semantics. The channel, board and harness-manager primitives this composes are documented already and behave identically |
| `apps/docs/guides/` | No change. This unlocks no new end-to-end workflow for a framework user — it proves one we already describe |
| `packages/*/README.md` | No change. No public export changes |
| `apps/docs/blog/` | No change. A launch-readiness proof is internal evidence; announcing it would be announcing a QA result |
| `docs/architecture/*` | No change. No locked contract moves |
| Changeset (BP-022) | **None required.** No published package changes, so no downstream consumer has anything to learn. Noted in the PR rather than as an empty fragment |

## The prose that does change, and where

Two internal documents, both of which ship in the same PR as the code they describe.

### UPDATE · `goals/devforce-lab/lab/README.md` · *What this directory owns, and why each piece is here*

Add two rows to the existing table and one line of framing above it. Draft:

> The lab now opens the channel it declares. `CHANNEL.md` used to be walked and never driven —
> the positive half of "an unwalked folder loads as nothing" and nothing more. The feature
> channel is now the front door: a post on it is what reaches the EM seat, and the EM seat is
> what files the row. The board hand-off underneath is unchanged.

| File | Why it is the lab's |
|---|---|
| the channel door in `host.mts` | Which channel this lab opens, and when, is the app's. `openChannels` takes no `orgId` and needs no wrapper — the server-created session carries the organization from the verified principal ([FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442)) |
| the bare clone in `scratch-repo.mts` | Where an artifact has to survive to is the lab's question, not the framework's. A temp-directory repository plus a bare clone the run pushes to keeps the check re-runnable with no credential while still giving the artifact an address that outlives the process |

### UPDATE · `goals/devforce-lab/lab/README.md` · *What it works around*

Append one paragraph. Draft:

> **One automated leg, and the verdict says which leg ran.** CI runs the local leg: the run
> pushes to a bare clone, and the artifact resolves there after the process exits, with no
> network and no credential. The pull-request release run is the same path with a real remote,
> and it is a human release step rather than a second leg the lab carries. A proof that quietly
> ran the weaker leg and reported the stronger one would be worse than no proof, so the leg is
> named in the verdict rather than inferred from whether `gh` happened to be installed.

### CREATE · `goals/devforce-lab/it-ships-an-artifact-a-person-can-open/goal.md`

The new check's own document, in the shape its two siblings already use — outcome, input, signal,
anti-game, controls table, model, run command, what it establishes and what it does not, verdict
log. The implementer writes it against what the check actually asserts; two sections are fixed by
this spec and are drafted here.

**Outcome** (draft):

> Somebody posts one line into a channel a Markdown file declared. A coordinator seat reads the
> post and files one row. A working seat the row names wakes in a checkout of its own, runs a
> real coding agent from a prompt built out of its own files, and leaves its work at an address
> that still resolves when the run is over — work that satisfies an acceptance check the brief
> named before the run started, written by the requester and applied from outside the checkout.

**What this establishes, and what it does not** (draft):

> It establishes that a hired Workforce can take a request through a channel and hand back a work
> product a person can open and judge. It does **not** establish that the product is *good* —
> only that it satisfies the acceptance condition its requester wrote down, which is the strongest
> claim a machine can make here and is deliberately weaker than a human review. It does not
> establish anything about a second Lab, about CyberForce, or about unbounded product delivery.

## Publication ownership

This issue publishes both documents in its own PR. The epic's shared narrative — what Workforce
is and how the three exit proofs relate — belongs to
[FIX-1457's wrap-time docs pass](../../epics/FIX-1457/DOCS.md), and is not duplicated here.
