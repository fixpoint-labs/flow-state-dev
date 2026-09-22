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
| the channel door in `host.mts` | The org is not threaded through `openChannels` yet ([FIX-1412](https://linear.app/fixpoint-labs/issue/FIX-1412)), so the session client is wrapped to inject one. The same wrap the two sibling labs carry, for the same reason |
| the two artifact legs in `scratch-repo.mts` | Whether the artifact leaves the machine is an operator's choice, not the lab's. The default leg stays a temporary repository so the check is re-runnable with no credential; the credentialed leg gives the artifact an address a person can open |

### UPDATE · `goals/devforce-lab/lab/README.md` · *What it works around*

Append one paragraph. Draft:

> **The pull-request leg needs a credential, and the check says which leg it ran.** A proof that
> quietly ran the weaker leg and reported the stronger one would be worse than no proof, so the
> leg is named in the verdict rather than inferred from whether `gh` happened to be installed.

### CREATE · `goals/devforce-lab/it-ships-an-artifact-a-person-can-open/goal.md`

The new check's own document, in the shape its two siblings already use — outcome, input, signal,
anti-game, controls table, model, run command, what it establishes and what it does not, verdict
log. The implementer writes it against what the check actually asserts; two sections are fixed by
this spec and are drafted here.

**Outcome** (draft):

> Somebody posts one line into a channel a Markdown file declared. A coordinator seat reads the
> post and files one row. A working seat the row names wakes in a checkout of its own, runs a
> real coding agent from a prompt built out of its own files, and opens a pull request — at an
> address that still resolves when the run is over, carrying work that satisfies a condition the
> brief stated before the run started.

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
