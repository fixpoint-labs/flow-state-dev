# @flow-state-dev/conductor

Development orchestration built on FSD. Conductor runs a software development
process: it drives a work item from problem through spec, review, implementation,
and PR feedback, dispatching the actual coding to a vendor harness and pausing
only where a human decision is genuinely required.

The process it encodes is not new — it is the one already written down in
`docs/contributing/orchestration.md`. Conductor does not invent it. Conductor
**executes it in code instead of interpreting it in a prompt.**

> **Status: M0 — nothing here runs end to end yet.**
>
> **In the tree:** the entity model; the pure driver (`decide`, `deriveGate`,
> `reconcile`); the two seams — `Dispatcher` for how work gets done, `Observer`
> for how the world is read — with their implementations, internal to the
> package rather than exported: Claude Code behind the first, GitHub and a local
> checkout behind the second; and the config surface (`defineConductor` /
> `resolveConductor` and its discovery).
>
> **Not in the tree:** the **tick** — nothing assembles observe → decide →
> execute, and there is no `openConductor`. **Persistence** — the collections
> described below are declared but never registered, so nothing survives a tick.
> **Phase execution** — running the actions `decide` produces. And the **CLI
> board**. All four are M1.
>
> The GitHub layer is tested against recorded payloads; the local source is
> tested against real repositories it creates and commits to. What has not run
> is the whole loop, because the piece that would run it is the tick.

## The shape

```
observed + fresh ──reconcile()──▶ Signal[] ──decide() per signal──▶ Action[] ──▶ execute
```

Three kinds of thing, kept deliberately separate:

| | What it is | Where it lives |
|---|---|---|
| **Phase** | where the work *is* (`SPEC`, `IMPLEMENTATION`) | stored on the entity; changed only by an `enterPhase` action |
| **Gate** | what the work is *waiting on* (`awaiting_ci`) | **never stored** — derived from a world snapshot every tick |
| **Signal** | what the world *reported* | transient; recorded in the ledger as it is reduced |

## The invariant

> **Every transition is reproducible from the ledger.**

Reproducible is meant literally, not as a slogan. `decide` takes three arguments
— the entity, the signal that arrived, and the world snapshot it was reduced
against — and a ledger row carries all three, whole. So a row replays:

```ts
decide(
  { id: row.entityId, kind: row.entityKind, phase: row.phaseBefore },
  row.signal,
  row.world,
);
// → the actions that were taken, including row.actionKind
```

That is what costs the ledger its size: a row is a few KB rather than a few
hundred bytes, because it archives the snapshot. The alternative — a hash of the
world, or only the facts the phase declared — would let you *verify* a
transition without being able to *re-run* it, and `src/model/entities.ts` walks
through why each cheaper option was rejected. A weaker invariant honestly stated
would have been fine; a strong one that the schema did not support was not.

A model may sit anywhere *upstream* of a signal. Classifying a human comment
into "this is feedback" versus "this is a question" is real judgment and belongs
to a model — its output is recorded as a signal, so a wrong call produces a
wrong-but-valid transition that is visible and replayable.

A model inside `decide` would produce a different transition each run from
identical state: unauditable, untestable, and the exact failure this design
exists to remove. The claim is not that judgment is unwelcome. It is that
**judgment must be recorded before it is acted on.**

**One limit, stated rather than buried.** A row written before the payload
fields existed reads back with `signal`, `world` and `entityKind` at `null`.
That row is still *auditable* — the phase chain proves nothing moved outside a
recorded action — but it is not replayable, and a consumer has to branch on it
rather than assume the payload is there.

## Why gates are derived, not stored

An earlier attempt at this system kept its progression in a second place
alongside the board, with no rule for who won. The two drifted, and a cold
restart between two gates looped forever.

Deriving is the fix. A gate is a pure predicate over a snapshot, so killing the
process while an entity waits on one loses nothing — the next tick re-derives
the same gate from the same world. There is no remembered gate to lose.

```ts
import { decide, deriveGate } from "@flow-state-dev/conductor";

const entity = { id: "FIX-1", kind: "issue", phase: "IMPLEMENTATION" } as const;

deriveGate(entity, world);
// → "awaiting_ci"

decide(entity, { kind: "ci_concluded", conclusion: "failure", sha, entityId: "FIX-1", at }, world);
// → [{ kind: "addressFeedback", entityId: "FIX-1", because: "CI failed on …" }]
```

## Entities are resources

Every entity is a resource collection, and every entity field lives in **resource
state**. Scope state is for in-process state management that persists only for
durability; conductor stores no entity data there.

Each entity uses both halves a resource already gives you:

- **`stateSchema` → `ResourceStateStore`** — the structured fields. This is the
  reducer's read set and nothing else.
- **content → `ContentStore`** — the prose: a spec document, a retrospective.
  Never read by `decide`.

> **Structured state is exactly what `decide` reads. Everything else is content.**

That split is what keeps the driver honest. `decide` is exhaustively testable
*because* it reduces over structured fields. The moment a phase, a gate, a round
count, or a review state drifts into prose, the reducer needs a model to read it
and the determinism claim collapses.

## Where entities live

**One session per epic. One workstream — a child session — per issue.** A tick is
a single request, not a session: a webhook, a cron beat, a CLI invocation and a
chat message all fire a tick *into* the session that owns the work. Webhook
bindings route by `sessionId(event)`; a cron sweep enqueues an action against a
session id. So the work's own session is where its record belongs.

| Altitude | Scope | Who sees it | Collections |
|---|---|---|---|
| Cross-epic | `org` | anything, including a tick belonging to no epic | `conductorRegistry` |
| Epic-level | `session`, `sharedToWorkstream` | the epic session and every issue workstream under it | `conductorEpics`, `conductorIssues`, `conductorArtifacts` |
| Issue-level | `session` | one workstream's own ticks | `conductorObservations`, `conductorDispatches`, `conductorLedger` |

A session-scoped resource resolves to one of two addresses: the running session,
or — with `sharedToWorkstream: true` — the lineage root. The lineage id is minted
by the root and inherited verbatim, so an issue workstream and the epic session
above it address one instance set. There is no third address, which is the rule
worth remembering: an unshared collection is readable from its own session's
ticks and from nothing else, including a phase execution that session detached.
A detached phase reports back as a signal, never by writing these rows.

The line between the two session altitudes: **the entity graph is shared, each
entity's working record is local.** Cross-spec review reads its sibling issues'
artifacts and the per-epic board renders the roster, so what exists and where it
is hosted has to be visible from above. An observed PR copy, a dispatch history
and a ledger are only ever reduced over by the tick that produced them.

An issue running without an epic needs no special case — its own session is the
lineage root, so the shared collections resolve there and the model is the same
one, minus a level.

**Org scope holds the registry and nothing else.** A cron sweep runs in no epic's
session, so it has nothing to read from either session altitude; the registry
tells it which sessions exist and it fans out one enqueue per session. Every
resource read is addressed by `(scope, scopeId, key)`, so a query across sessions
is not a primitive — a board spanning every epic is that same fan-out. Note the
cost: org-scoped resources require the request to resolve an `orgId` from its
principal, so conductor must run org-bound for the registry to resolve at all.

## Gates declare what they read

A gate asks a question about the world, and the world lives in GitHub — which is
in tension with `decide` being pure. The resolution is that the tick materializes
the answer first: by the time a predicate runs, everything it needs is plain data.

```ts
{
  name: "awaiting_ci",
  reads: ["pr.state", "pr.checkRuns"],       // fetched during read-world
  appliesWhen: (w) => implPr(w)?.state === "open",
  satisfiedBy: (w) => implPr(w)?.checks === "success",
}
```

This is the framework's own `uses`/capability shape — declare the dependency, get
it injected — not a new mechanism. Two consequences, both accepted: the tick may
over-fetch, and a phase cannot gate on a fact it did not declare.

## Reconciliation

Conductor keeps a copy of every PR fact it has seen. The copy is an asset: it is
the only thing a dropped event can be detected against.

A comment arrives for a PR conductor never saw opened. Without a copy that is
simply lost. With one it is a divergence — which is how conductor knows to
backdate the missed `pr_opened` and reduce it *before* the comment that revealed
the gap.

Two rules separate a cache from a second authority:

- **GitHub always wins.** Reconciliation never walks a PR backwards. A copy that
  says merged against a read that says open means the read is stale; the
  divergence is recorded and no signal is produced.
- **No new signal kinds.** Reconciliation re-emits the ordinary vocabulary with
  `synthesized: true` and a backdated `at`, so a replayed history and a live one
  reduce identically.

## Two seams

A tick has two halves that belong to somebody else, and each gets a seam.

```
Observer.observe() ──▶ { world, signals } ──▶ decide() ──▶ Action[] ──▶ Dispatcher.run()
```

`Dispatcher` abstracts **how work gets done** — Claude Code today, another
coding harness tomorrow. `Observer` abstracts **how the world is read**:

```ts
interface Observer {
  readonly source: string;
  observe(request: ObservationRequest): Promise<Observation>;
}
```

An observation carries the world snapshot `decide` reduces against, the signals
since the last one, the divergences that produced no signal, the cursor to
persist, and which world facts the phase's gates declared. Conductor stores the
cursor verbatim and hands it back; how a source learned something changed —
polling, a webhook, a file watcher — is its own business, because `reconcile`
turns any source's fresh facts into the same signals.

Neither seam carries a vendor noun. If a field only makes sense for one
implementation, it lives in that implementation's options.

## Reading a local checkout

The second observer reads a real git repository, which is what makes the process
runnable without GitHub — no issues burned, no PRs opened, and a kill-mid-gate
restart you can actually try.

| World fact | GitHub | Local |
|---|---|---|
| `headSha` | the PR's head | `git rev-parse <branch>` |
| `state: merged` | the merge flag | `git merge-base --is-ancestor <branch> <base>` |
| `mergeable` | a cached background computation | `git merge-tree --write-tree`, the merge itself |
| `checks` | check runs on the head | what a real check run recorded for that commit |
| `reviews` | submitted reviews | verdict files a human wrote |
| `guidanceHashes` | the contents API's blob sha | `git hash-object`, the same blob sha |

The parts git does not hold are files under the checkout:

```
.conductor/local/
  submissions/1/submission.json     { number, branch, base, openedAt }
  submissions/1/reviews/alice.json  { reviewer, state, sha? }   ← a human writes this
  submissions/1/comments/alice.1.md free prose                  ← and this
  checks/<sha>.json                 { conclusion, at }          ← a real check run writes this
```

**This is not a second fake.** The replay harness in `./testing` is one, and says
so: it is handed a world per step and a dispatcher with scripted results, which
is right for exercising `decide`'s matrix in milliseconds and proves nothing
about whether anything works. Nothing in the local source is handed an answer. An
empty review inbox means nobody has reviewed the work.

A reviewer may leave the SHA out of their verdict, and normally does. The file's
modification time and git's commit times together say which head they were
looking at, so an approval written before a push keeps pointing at the head it
saw — the staleness rule holds without anyone cooperating with it.

Changing your mind means editing the same file. Save `alice.json` again with
`APPROVED` where it said `CHANGES_REQUESTED` and the next observation reports the
new verdict, because a review is identified by the file, what it says, and when
it was saved. Re-saving an unchanged verdict counts too: that is how you say you
looked at the new head and still stand behind it. Nothing here asks a reviewer to
write down a version of their own.

Submission numbers are claimed on the write side (`openSubmission`), from what is
already on disk, exactly as GitHub assigns a PR number when you open one. An
observer that minted identity while reading would be inventing the thing it is
supposed to be reporting.

## Configuring it

A project's whole configuration:

```ts
// conductor.config.ts
import { defineConductor } from "@flow-state-dev/conductor";

export default defineConductor();
```

That is not a trimmed excerpt. The four things conductor needs before it can start are
facts of the machine it runs on, so it reads them rather than asking:

| Not configured  | Discovered from                                              |
| --------------- | ------------------------------------------------------------ |
| the repository  | `git remote get-url origin`, in the checkout conductor runs in |
| GitHub auth     | `GITHUB_TOKEN` / `GH_TOKEN` — the variables `gh` already uses  |
| the base branch | the remote's HEAD                                             |
| the dispatcher  | the coding harness that can actually be loaded (Claude Code's Agent SDK, today) |

**A field earns its place only if it encodes an intent the environment cannot reveal.**
Asking for something discoverable is not a harmless knob — it is a second place for one
fact to live, which is how the config and the machine end up disagreeing.

**A discovery that cannot answer raises; it never defaults.** No fallback to `main`, no
"dispatch to whichever vendor we shipped first". `ConductorConfigError` names the field
that overrides it. Both of those failures would otherwise surface twenty minutes later,
wearing something else's clothes.

**A harness probe asks whether the thing the dispatcher loads will load.** Not whether
something with a similar name is on `PATH`: dispatch runs through the Agent SDK, which
brings its own executable, so a `claude` binary is neither necessary nor sufficient and
probing for one gets the answer wrong in both directions. Discovery and dispatch go
through one resolver, so they cannot disagree.

Declaring and resolving are separate on purpose. `defineConductor` is a typed identity
function returning plain data, so `conductor.config.ts` stays synchronous and importable
anywhere — an editor, a test, a machine with no git and no token. `resolveConductor` is the
async half that touches the environment, and it runs inside conductor's own process where a
failure has somewhere to be reported.

```ts
import { resolveConductor } from "@flow-state-dev/conductor";

const config = await resolveConductor(declared, { cwd });
config.origins; // { repoRoot: "discovered", repo: "discovered", … }
```

`origins` answers the first question a project asks — *what did it decide, and did I decide
any of it?* — and is what a board renders.

Fields do exist for the cases inference genuinely cannot cover: `repo` for a fork whose PRs
belong upstream, `remote` for a checkout with several, `repoRoot` for one conductor driving a
repo it is not inside, `dispatcher` to pin a vendor, and `guidance` for the documents
conductor should read (the one field with no discovery behind it — which documents govern a
project is the project's own statement).

`examples/conductor-self-drive` is the whole thing end to end: a level-1 config, and a small
piece of source for conductor to change.

## What conductor never does

It never merges. Three human gates exist — the epic objective, each spec, and
every merge — and everything between them moves without asking.

## Development

```bash
pnpm --filter @flow-state-dev/conductor test
pnpm --filter @flow-state-dev/conductor typecheck
```
