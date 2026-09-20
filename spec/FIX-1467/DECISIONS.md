# FIX-1467 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Two decisions and one open fork are the sign-off surface. The POC that moved this document is
[`spec-poc/FIX-1467-references-vs-resources/`](../../spec-poc/FIX-1467-references-vs-resources/).

## The tree

```mermaid
flowchart TD
  I["FIX-1467 · split RO refs from mutable resources"] --> D1["D1 · a reference is a READ PATH<br/>from disk every read, no write path"]
  D1 -.->|"rejected"| X1["rename the folder, set writable:false per file<br/>one forgotten key and it is mutable again"]
  D1 -.->|"rejected"| X2["keep the row, re-seed from disk on boot<br/>a deploy silently discards what the product wrote"]
  I --> D2["D2 · tree scope is DERIVED and enforced at hire"]
  D2 -.->|"rejected"| X3["keep the app's filter, add ambient on top<br/>the only wall stays a line the app must remember"]
  I --> Q["OPEN · ambient reach:<br/>always-on, or opt-out per kind?"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A reference is a read path, not a renamed folder: `references/` is served from disk on every read and has no write path

| | |
|---|---|
| **Instead of** | Renaming `resources/` to `references/` and relying on `writable: false` in each file's frontmatter |
| **Because** | There is no read-only thing to rename. The POC wrote to an org handbook through an ordinary seat and read it back from a fresh context: `expected 'DEFACED' to contain 'ORG HANDBOOK v1'`. Today's document is *already* seed-then-evolve — the disk body is a first-boot seed, a write persists, and the file in git becomes dead weight that nothing reports |
| **Locks in** | Org knowledge becomes deploy-only. Nobody fixes a handbook typo from inside the product, ever; they move the file to `resources/` and accept that the row becomes the source. In exchange the reverse promise holds: what is in git is what the agents read |

The issue's framing was that Door A behaves like a skill's `references/` and needs the matching
name. Half of that survived checking. The model cannot write one (`llmWritable` is off by
default), which is why it *feels* read-only; code can (`writable` is on by default), and after
one write the persisted body wins forever. So the work is a read path that does not exist yet,
and the folder name follows from it rather than the other way round.

**What would change my mind:** a handbook someone genuinely wants edited in-product *and* kept
in git. That is two sources of truth, and it needs a sync story rather than a read path.

<a name="d2"></a>
## D2 · The tree scope is derived from the path and enforced where a seat is minted, replacing the app's hand-written install filter

| | |
|---|---|
| **Instead of** | Keeping `documents.filter(d => d.ref.startsWith("teams/engineering/"))` as the documented way to scope a kind, and layering ambient inherit on top |
| **Because** | Cross-team isolation is a hole, not a property to preserve. The POC hired an ordinary seat with no grant list and read another team's handbook off it. The wall exists only as a line the app remembers to write; when it is missing nothing warns and nothing logs. The loader already mints `teams/<id>/<name>`, so the wall can be derived from what it knows |
| **Locks in** | Where a file sits becomes a permission, so moving one between team folders needs the care a grant change needs. An app that wants one kind to see the whole org has to say so out loud instead of getting it by default |

The issue said per-seat whitelist sync would not scale. On `main` it already does not apply:
absent `resources:` narrows **nothing**, so no seat whitelists anything. The cost actually paid
is one level up — a hand-written filter per kind, invisible and unenforced. That is a better
argument for this ticket than the one it was filed with, and the same fix.

**What would change my mind:** a scoping shape the org → team → worker tree cannot express, such
as a document two sibling teams share. Then the tree is the wrong axis.

## Decided, not asked

- **`writable: false` is not the mechanism.** It stays available on a `resources/` document; a
  per-file opt-in simply cannot carry a convention.
- **Absent `references:` means ambient, present means narrow.** The only reading under which the
  shipped absent-is-not-empty rule in `hireWorkforce` stays coherent.
- **Invent-kills honoured:** no References L1 type; no dual-run under both folder names; no
  shared loader with skill `references/`; no second registry or merged md+ts scan; D-11 not
  reopened.
- **[#1943](https://github.com/fixpoint-labs/flow-state-dev/pull/1943)'s grant keeps its shape** — bare is `ro`, `rw` is the extra word, a grant narrows
  and never widens. [FIX-1381](https://linear.app/fixpoint-labs/issue/FIX-1381) D1–D3 untouched.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Rename the folder, set `writable: false` per file | The convention rests on a key an author can forget, and the POC's control shows one forgotten key restores the write path |
| Keep the row, re-seed from disk on every boot | A deploy silently discards whatever the product wrote — destroying data is worse than stranding a file |
| Keep the app's filter, add ambient reach on top | Leaves the only cross-team wall optional, and adds a second access mechanism beside it (tenet 5) |
| Do nothing; teach `writable: false` in the docs | The honest cheapest contender. Fixes neither red leg: the file still stops being the source, and the cross-team read is untouched |
| Claim the bash mount here | References are on no mount at all, so it is net-new with its own shape. It belongs to [FIX-1382](https://linear.app/fixpoint-labs/issue/FIX-1382); absorbing it hides a second feature in a rename |

<a name="open"></a>
## Open · one live fork

**Does a reference reach every seat under its scope automatically, or does an operator get a
switch to turn that off for a kind or an org?**

- **In plain terms.** Whether a newly hired agent automatically knows the company handbook, or
  somebody has to remember to let it.
- **The trade-off.** Always-on means hiring costs zero configuration, and anything dropped into
  `org/references/` reaches everyone under that org — the blast radius of adding a file is
  *everybody*. A switch lets a tight team run tight, and adds a setting people forget, which
  surfaces as an agent that mysteriously does not know the handbook.
- **Recommendation: always-on, no switch.** The narrowing that matters is the tree, and a seat
  wanting less already has an explicit `references:` list. A switch is a third mechanism beside
  two that work.
- **What would change my mind:** a seat that must read *nothing* ambient — a contractor desk, an
  untrusted agent. That is an isolation level, not a narrowing, and needs its own answer.
- **What being wrong costs:** little, and asymmetrically. Adding an opt-out later is additive;
  removing an always-on default later breaks every app that leaned on it.

<a name="carried-open"></a>
## Carried open · recorded, not put to the owner

The issue named four things that must not be pretended locked. One is the fork above. These
three are **not** on the sign-off surface, because none can be decided before the direction is:

- **Exact `WORKER.md` key names.** The spec writes `references:` so the prose reads;
  [PLAN.md](PLAN.md#pinned-names) pins it as *deliberately unpinned*, settled at implement time.
- **Migration order.** Sequencing, in [PLAN.md](PLAN.md#sequence). Constrained by one thing: no dual-run.
- **How templates under `resources/` seed without reading as read-only docs.** Partly answered:
  today *everything* seeds-then-evolves, so a template is the ordinary case and a reference is
  the new exception. Whether that suffices is [FIX-1388](https://linear.app/fixpoint-labs/issue/FIX-1388)'s question.

**One finding belongs to the epic, not here.** Every document is minted `scope: "org"`, so the
tree is a *name*, not a storage scope — D2's wall is enforced at mint time and cannot narrow two
people acting under the same org principal. That meets W5's principal-bound action authorization
in [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455). Raised, not resolved here.

## Settled

All four by the POC, on `main`, with a one-input control beside each red:

- **The disk body is a first-boot seed, not the source** — **CONFIRMED**, and it refutes the
  issue's framing. `expected 'DEFACED' to contain 'ORG HANDBOOK v1'` (leg 3).
- **An ungranted seat reads another team's references** — **CONFIRMED** (leg 2).
- **Loaders walk `workforce/**/resources/` and mint path-qualified refs** — **CONFIRMED** (leg 1).
- **A reference is on no bash mount** — **CONFIRMED.** A document is a single resource with no
  `pattern`; `discoverMounts` keeps collections only (leg 5).

## How it got here

- **Draft** — framed as the issue's vocabulary rename; POC built first, against `main`.
- **POC** — reframed D1 from *rename the folder* to *build the read path*, because the disk body
  is a seed. Reframed D2's argument from *per-seat whitelist sync* to *the app's per-kind
  filter*, because absent-key already inherits. Moved the bash mount out of scope.
