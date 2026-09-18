# FIX-1416 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

What was considered, what was chosen, and what each locks in. Two decisions are the sign-off
surface. The fork that stood open here is **closed** — not by being answered, but because [D2](#d2)
was decided in a way that dissolved it; see [Open](#open).

## The tree

```mermaid
flowchart TD
  I["FIX-1416"] --> D1["D1 · wiring, guards, docs<br/>plus one built thing: registration"]
  D1 -.->|"rejected"| X1["a tools registry beside the blocks scan<br/>a second map naming the same files"]
  I --> D2["D2 · a folder REGISTERS a name<br/>the seat's tools: still grants its use"]
  D2 -.->|"rejected"| X2["deliver it as a capability controlTool<br/>says the opposite of what a control is,<br/>and leaks to every seat of the kind"]
  D2 -.->|"rejected"| X3["ambient — the folder grants use by itself<br/>costs tools: its status as the one place to look"]
  D2 --> Q["the levels fork · DISSOLVED by the ruling<br/>all three register; none grants"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · The primary recipe ships as wiring, guards and documentation — no new public option. The one thing it builds is registration

| | |
|---|---|
| **Instead of** | A tools registry beside the blocks scan, a `blocks → tools` adapter, or a third `tools/` convention |
| **Because** | Nearly all of it already works and nobody checked. A scanned block **is** a generator tool by definition (`GeneratorTool = BlockDefinition`, `packages/core/src/blocks/generator.ts:347`), the generated map **is** the catalog's shape (`ToolCatalog = Record<string, GeneratorTool>`, `packages/core/src/types/skill.ts:28`), the mint already refuses a name the catalog lacks (`packages/workforce/src/agent-worker-flow.ts:295`), and the fence already governs the result. The POC ran that path end to end with no adapter. The exception is stores — see the qualifier below — and one registration closes it |
| **Locks in** | The app stays the only place that decides which blocks a workforce may reach — `catalog:` is a line in the app's own code, not a file a team edits. A team cannot grant itself a non-colocated tool by editing files alone. That is deliberate, and it is the reason the colocated half below is a separate decision rather than a generalisation of this one. **And every store any catalog tool declares is installed on the kind, for every seat of it** — including seats whose `tools:` never name that tool. That is what kind-wide means, and it is the same bill `uses` already presents |

**The qualifier, found in review, and worth reading before the paragraph below.** "Already works"
was true of tools that need *nothing*. A seat reaches its tools through a resolver that runs per
turn off `ctx.flow.config` (`agent-worker-flow.ts:615-616`), so a block arriving that way was never
an action block and is outside the walk that installs a block's stores
(`defineFlow.ts:710-721`). The POC ran it on the catalog path: the flow does not know the store,
the tool is advertised to the model anyway, and a block that really uses its handle **throws inside
itself while the turn reports success** (test 7). So D1 now carries one thing it must build — at
kind construction, merge `declaredResources` from the catalog's entries into the kind — and that is
a behaviour derived from the `catalog` option that already exists, not a new door.

**This is D1's own *If wrong* firing, and it fired before anything shipped.** The card said the risk
was documenting a seam as supported when it needs more than wiring. That is exactly what review
found. Recording it because a spec instrument that catches its own failure mode is worth more than
a spec that was right by luck.

The evidence that this was a gap and not a design hole: `apps/kitchen-sink/workforce/hire.ts:43`
passes no catalog at all, and reaches its one custom block as a **flow action** through a relative
import (`apps/kitchen-sink/workforce/flows/workers/desk-clerk.ts`). The one place that *does* build
a catalog — the pentest lab, `goals/pentest-lab/lab/host.mts:279` — assembles it by hand from a
file outside the convention tree and runs no scan at all. The published docs say the generated
`blocks` map feeds "a task board's `workers`"
(`apps/docs/docs/workforce/workers-on-disk.md:411`) and say nothing about tools. So the recipe the
architect called primary has never been written down, wired, or proved — which is mostly a
documentation and proof deliverable, and one small build.

<a name="d2"></a>
## D2 · A `blocks/` folder REGISTERS a name for the seats that can see it. The seat's `tools:` is what grants its use

**Decided by the owner, in their own words, after this document was approved.** The paragraph below
the table records what was *proposed* and why; this table records what was *decided*. Implemented on
[#1909](https://github.com/fixpoint-labs/flow-state-dev/pull/1909).

> `blocks/` is a way of registering a block by name that can be used… if a skill uses a block, it has
> the block registered so that it can add it to its tools list, **but it must add it**. Same for task
> board workers. It's just a way of registering what a name refers to.

| | |
|---|---|
| **Instead of** | (a) Delivering it through a capability's `controlTools`, the one shipped exemption the fence has. (b) **Ambient** — the folder grants use by itself, which is what this document proposed and what the paragraph below argues for |
| **Because** | Registering a name and granting its use are two different things, and only the second is a permissions question. A folder answers *what does this name refer to, for this seat*; the seat's `tools:` answers *what may this seat call*. So a block in `workers/<name>/blocks/` becomes **resolvable by that seat** and is not callable until the seat names it. `tools:` therefore stays the complete and exclusive answer, the fence does not move, nothing is exempted from it, and core is untouched. Precedence for resolving a name is **worker → team → org**, first match wins — name resolution, not set merging. Skills union because they are all active; blocks resolve because they are *named*. The `controlTools` route stays rejected for its own reasons: core's doc reserves `controlTools` for a tool "whose presence is already implied by the block's own configuration" and sends anything granting new reach to `tools` (`packages/core/src/capability/types.ts:106`), and a capability is installed on the **kind**, so one worker's folder would hand its tool to every seat of that kind (`codegen/discover-resource-modules.ts:80`) |
| **Locks in** | A file appearing in a folder never widens what an agent can do. `tools:` keeps its status as the one place to look, so the built-in kind's own documentation — "a seat with `tools: []` reaches nothing, delegated or not" (`agent-worker-flow.ts:51`) — stays literally true of both halves. The cost moves to the other side of the ledger: a block an author drops beside a worker does nothing until they also add a line, which is one line of churn per seat per tool and is the audit trail. What this does **not** lock in is a precedence story at run time: a name resolves to exactly one block at build time, and the shadowed one is not also registered |

**What was proposed here, and why it lost.** The proposal was that a tool in the worker's folder is
ambient — "because why else would it be in that folder" — which is the same argument that makes that
seat's `skills/` folder ambient. It is a good argument and it is why this document carried it. Its
price was written down honestly at the time: `tools:` stops being the complete answer to *what can
this seat call*, a seat with `tools: []` and a `blocks/` folder reaches those blocks, and anyone
auditing a seat has to read the file **and** the folder — not recoverable later without breaking
trees that relied on it. The owner's ruling declines to pay that price, and the argument it declines
it with is that the skills analogy does not hold: a skill is text in a prompt and a tool is running
code with side effects, so "it is here, therefore it is yours" is a different proposition for each.

**Two things this refunds.** The follow-up D2 called for — a `fsdev` command printing a seat's full
model-visible toolset — was the mitigation for a cost that no longer exists, so it is no longer owed
*for this reason*. And the fork below dissolves rather than being answered.

<a name="d3"></a>
## Decided, not asked

- **The seat's own blocks ride the HIRE step, not a second option on the kind factory.**
  `hireWorkforce` already imposes every other per-seat bag — `instructions`, `teamInstructions`,
  and `seatSkills` from `manifest.skills` (`hire.ts:361`), each refused when an author writes it
  (`hire.ts:249`, `:258`, `:271`). A seat's own blocks are the same kind of thing, so they become
  the **fourth contract key** rather than a new door. The POC checked the one premise that was not
  obvious — the three existing keys all carry strings, and this one carries live blocks: a
  `BlockDefinition` on a seat's settings bag survives the mint and the model calls it (POC test 5).
  <br/>**What the kind-factory route would have bought, and why it is worth nothing here:** the
  factory knows the map before `defineFlow` runs, so it *could* merge colocated resource
  declarations statically — the hire path cannot, because the flow is built before any seat exists.
  But collecting one seat's resources onto the kind installs them for every seat of that kind, which
  is the leak this convention already refuses by name, and per-seat resource installation does not
  exist in workforce at all (kitchen-sink and the pentest lab both install resources kind-wide). The
  advantage is one the factory route could not take. With it gone, the hire path wins on symmetry,
  and **D1 adds no new public option to `defineAgentWorkerFlow`** — the one thing D1 builds is
  registration, which is derived from the `catalog` it already takes.
- **A catalog block's resource declarations are registered on the kind; a colocated block's are
  refused. Same word, two verdicts, and the asymmetry is the whole point.** The app's `catalog` is
  a kind-construction argument and is **already kind-wide** — every seat of the kind shares it — so
  merging its entries' `declaredResources` installs exactly what the kind's own `uses` would have
  installed. Nothing leaks, because there was never a per-seat boundary to leak across. The seat's
  own folder is the opposite: it is one seat's, it arrives at hire after the flow is built, and
  collecting it would install seat A's store for every sibling. So the catalog half is registered
  and the colocated half is refused, and the reason is *where the map is scoped*, not which is more
  convenient. **Both cases are the defect class [FIX-1421](https://linear.app/fixpoint-labs/issue/FIX-1421)
  shipped a detector for tonight** — an author writes what the convention documents, it is accepted,
  and nothing happens until it fails somewhere unrelated. Landing a new instance of it in the same
  epic would have been poor.
- **A colocated block may USE a store the kind already has; it may not DECLARE one, and one that
  does is refused by name at hire.** `defineFlow` collects `declaredResources` by walking the
  flow's *action* blocks (`defineFlow.ts:710-721`); a block appended through the function-valued
  `tools:` resolver is not one, so its declarations are never seen. The POC ran it: hire accepted
  the seat, the turn **did not error**, and the store handle was simply absent inside `execute`
  (test 6) — a tool advertised to the model, doing nothing, with nothing said anywhere. That is the
  defect class this epic exists to kill, so the refusal is not a stopgap. The alternative —
  collecting colocated declarations onto the kind — is more useful and costs the same leak as
  above: seat A's store installed for every sibling seat. Refusing is smaller, honest, and leaves
  the useful case open, because the two fixes are both one line: declare the store on the kind, or
  move the block to `workforce/blocks/` and name it in `tools:`.
- **One tool has one name: the file's, the map key's and the block's own must agree — on BOTH
  maps, the app's catalog and the seat's own — refused when the workforce is hired.** This is the
  engineer's call, not a fork — the alternative is an ambiguity nobody wants — but it is recorded
  here because the POC is what found it and because it binds something public. A seat authorized
  `lookup-customer` (the file name, and the catalog key) and the model was advertised
  `lookupCustomer` (the block's own `name`); the call by the authorized name never landed and the
  call by the other one did. Nothing checks they agree, and three readers each use a different one
  — the seat's `tools:` list, the model's prompt and trace, and a skill's `allowed-tools`
  validation. The guard goes at the kind's door rather than at the scan, so it also covers a
  hand-built catalog and leaves a block used only as a flow action alone.
  <br/>**Both maps, because the seat's own map is filename-keyed too** and would otherwise rebuild
  the ambiguity on the second surface. The one-name rule itself is unchanged by the decided
  [D2](#d2); what the decision changed is its neighbour. The collision check (BR-8) was a
  **refusal** when a name could reach a seat from two places at once with no answer between them.
  Under the ruling there is always an answer — worker → team → org, first match wins — so a seat's
  own `bar` shadowing a catalog `bar` is resolved rather than refused, and it is resolved at build
  time, once, with the shadowed entry not also registered. There is no precedence story at run time
  and nothing fails on a first turn.
  **What it binds:** a file's basename is now a tool name a model sees, so tool names inherit the
  segment rules — lowercase, digits, single hyphens, and **no dot**, because a dot is the joiner a
  worker id is split on (`packages/workforce/src/loader/segments.ts:29`). A namespace prefix like
  `engineering.*` therefore cannot be minted from a file name;
  [FIX-1434](https://linear.app/fixpoint-labs/issue/FIX-1434) needs to know that before it picks a
  spelling.
- **A colocated tool does not travel to a worker the seat delegates to.** The delegation fence
  narrows a board worker to the delegating seat's own `tools:` list (`agent-worker-flow.ts:521`),
  so that line keeps its exact current meaning. Under the decided [D2](#d2) this falls out of
  **where the name landed** rather than from a rule of its own: a name that resolved to the seat's
  own folder is carried as a resolved block on the seat's bag, and the names that stayed on `tools`
  are the catalog half the fence reads. A delegated worker is its own seat, with its own folder and
  its own list, which is coherent and needs no new rule.
- **The colocated folder is called `blocks/`, not `tools/`.** The architect fence forbids a parallel
  `tools/` tree, `resources/` already demonstrates one folder name repeated at every level, and the
  tree docs currently describe a `tools/` folder as "layout, not input"
  (`apps/docs/docs/workforce/workers-on-disk.md:463`) — a line this issue reconciles rather than
  contradicts.
- **A `tools/` folder anywhere in the tree stops being silently ignored** and is reported by
  `fsdev gen` with the fix. Silence is what produced this issue's confusion in the first place.
- **Both halves stay build-time walks.** Nothing scans a folder at run time; that is settled by the
  convention and restated only because a per-seat map invites the question.

## Considered and dropped

| Alternative | Why not |
|---|---|
| A `tools/` tree, at any level | Duplicates `blocks/` with a second registry naming the same kind of file. Explicitly fenced by the architect, and the tree already reserves the name as layout |
| Name-intersecting capability tools with a seat's `tools:` instead of dropping them | Already settled and shipped as *drop* (FIX-1393); re-opening it is out of scope and the core doc explains why the intersection was inert |
| Let a seat's `tools:` widen itself with a prefix (`engineering.*`) as part of this | [FIX-1434](https://linear.app/fixpoint-labs/issue/FIX-1434). This spec does not depend on it, and the one-name rule constrains it — see "Decided, not asked" |
| Make every scanned block's `name` equal its basename, at gen time | Broader than the harm. A block used only as a flow action never reaches a model, and kitchen-sink's own block documents that the two names are allowed to differ. The one-name rule puts the guard at the door where the harm is, which also covers a hand-built catalog |
| A second option on `defineAgentWorkerFlow` for the per-seat map | Hire already carries every other per-seat bag, and the one thing the factory route could have bought — statically installed colocated resources — is closed by the kind-wide resource model regardless. See "Decided, not asked" |
| Collecting a colocated block's resource declarations onto the kind | More useful than refusing, and it installs one seat's store for every seat of that kind. Impossible on the hire path anyway. Refusal named at the door leaves the same case open through one extra line |
| **Limiting D1 instead of registering** — a catalog tool that declares resources is out of the recipe, and the author declares the store on the kind or mounts the block as a flow action | Honest, and it makes the primary recipe worse at the one thing it exists for. The catalog is already kind-wide, so registering costs nothing the kind was not already paying, and it makes D1's claim true rather than true-for-resource-free-blocks. Rejected on those grounds, not because it was unworkable |
| **Holding PR2 until the levels fork is answered** | Dropped during review, and vindicated: the fork never needed answering. `BR-10` gave PR2 a rule to build against, and when [D2](#d2) was decided the fork dissolved and `BR-10` widened — additively, changing no file that already existed, exactly as the reasoning for not holding predicted |

<a name="open"></a>
## Closed · the fork that stood here

### Tools sitting in a folder: only the worker's own, or the team's and the org's too?

**Dissolved by [D2](#d2), not answered.** The question only exists while a folder GRANTS use. Once a
folder merely registers a name, "how far up the tree does *automatically* go" stops being a
permissions question and becomes a name-resolution one, which the owner's ruling answers outright:
**worker → team → org, first match wins.** All three levels register; none of them grants. So the
built recipe reads every level, and `BR-10`'s refusal moved from "the team and org levels" to the
levels that have no seats under them at all — `org/` and `org/workers/<worker>/`, where a `blocks/`
folder can reach nobody however it is read.

The argument below is kept because it is the reasoning that was weighed, and because the thing that
dissolved it is worth seeing: **the entire case for worker-only was blast radius**, and the declared
rule sets the blast radius to zero. Read it as the record of a fork, not as an open one.

**Plain terms.** A worker gets a folder on disk. Anything in it is already theirs automatically —
their instructions, their skills. The ruling adds tools to that list. The question is how far up the
tree "automatically" goes. A team has a folder too, and so does the whole organisation. Drop a tool
in the team's folder and either every seat on that team can use it the moment the file exists, or
nobody can until each seat lists it by name.

**The trade-off.** Ambient at the team level is convenient and matches how skills already work: one
file, and a ten-person team has the tool. It also means adding one file silently changes what ten
seats can do, with nothing in any of their own files recording it — and a tool is running code with
side effects, where a skill is text in a prompt. Naming it per seat costs a line of churn per seat
per tool, and the line is the audit trail.

**The recommendation at the time — superseded by the ruling above: the worker's own folder only, for now.** A team-wide custom tool goes in
`workforce/blocks/` and each seat names it. The blast radius of "one file, ten seats, no record"
is the wrong default for code the model can execute, and this is the direction that is cheap to
change later: a folder that is currently refused can start being read without altering the meaning
of any file that already exists. The other direction breaks working trees.

**What would change my mind:** if you expect a team-shared custom tool to be the *common* shape
rather than the exception — a pentest team where all six seats want the same scanner. Then a line
per seat per tool is churn people will route around, most likely by putting the tool in one seat's
folder and delegating to it, which is worse than the thing I'm trying to avoid. If that's the
picture you have of how teams will use this, take the blast radius and make the team level ambient
in the first cut.

**Cost of being wrong: low, and asymmetric.** Wrong in my direction costs a line per seat until we
widen it. Wrong in the other direction is a permissions surface we can't narrow without breaking
trees. That asymmetry is most of my argument; if you have the usage picture I don't, it outweighs
it.

**What actually happened:** the line per seat per tool is what shipped — for every level, not just
the team one — because under the declared rule that line is the grant. The asymmetry that made this
fork worth asking about is gone with it: widening a level now only changes which names a seat can
resolve, never what it may call.

## How it got here

- **Draft** — framed from the shipped fence and the shipped scan rather than from the ticket's
  wishlist; a POC ran the primary recipe end to end and found the two-names gap, which nothing in
  the repo had asked about.
- **Review round 1** — D2's delivery route moved from a kind-factory option to the hire step, after
  the POC showed a live block survives a seat's settings bag and the factory route's one advantage
  turned out to be unusable. A hole in D2 was closed: a colocated block that declares a resource is
  advertised to the model and finds no handle, silently, so declaring one is now refused by name.
  The one-name rule was extended to the colocated map and its collision check restated over
  resolved tool names. PR2 stopped waiting on the levels fork, which remains open and unanswered.
- **Decided after approval** — the owner ruled D2 in their own words: a `blocks/` folder registers a
  name, and the seat's `tools:` grants its use. The decision is amended into [D2](#d2) in place, with
  what was proposed kept beside it. The levels fork dissolved rather than being answered, and the
  `fsdev`-command follow-up D2 asked for is no longer owed for D2's reason. Implemented on
  [#1909](https://github.com/fixpoint-labs/flow-state-dev/pull/1909), which also carries the fix for
  the resource gap below on **both** paths: a catalog block's declarations are registered on the kind,
  and a colocated block that declares one is refused by name. The symptom this document predicted for
  that gap is **wrong** and #1909 does not repeat it — it does not reliably throw
  `Resource "<accessor>" is not registered`. Colocated with a guarded read there is no throw at all;
  through the catalog with a real read it is a `TypeError`. In both cases **the turn reports
  success**, and that silent success is the danger.
- **Review round 2** — the resource gap turned out to be wider than the colocated half: a block
  reached through `catalog:` is outside the same walk, so D1's "already works" was overstated. The
  POC reproduced it on that path (test 7) and D1 now carries one built thing — the kind registers
  what its catalog declares — with the catalog/colocated asymmetry written down. The one-name
  rule's two moments were stated explicitly instead of being implied differently in two documents.
