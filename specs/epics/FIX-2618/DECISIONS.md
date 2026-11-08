# FIX-2618 · Decisions

[Spec](SPEC.md) · **Decisions**

The calls above any single issue, and what each locks in for the twelve children. D1 to D3 are
the sign-off. O1 to O5 are open holds for the owner: each revisits or extends an earlier
sign-off, which the owner has said may be reopened, and each keeps the earlier decision's reason
in view. The rest were decided while drafting and are recorded so no child reopens them.

## The tree

```mermaid
flowchart TD
  E["FIX-2618"] --> D1["D1 · one epic, proofs first, now"]
  D1 -.->|"rejected"| X1["four epics in order"]
  E --> D2["D2 · build specs after the proofs"]
  D2 -.->|"rejected"| X2["one spec set for all twelve"]
  E --> D3["D3 · lab adapters stop growing"]
  D3 -.->|"rejected"| X3["grow until kits land"]
  E --> O["O1 to O5 · open for the owner"]
```

<a name="d1"></a>
## D1 · Four changes in one epic, the proofs first, now

| | |
|---|---|
| **Instead of** | Four epics in dependency order (views, resource addressing, notice ids, kits), as the design review first proposed · or views and resources alone, with kits never |
| **Because** | Each change leans on the others. A kit packages views and resources, so its shape is decided by theirs; in four epics the kit epic inherits names and seams it never chose. The objective needs the adapter gone, and only the kit's client half does that at the root. The owner has put kits in scope as FSD's own composition unit |
| **Locks in** | A large epic (twelve children) and one closure over four mechanisms. A collapse trigger: if FIX-2622 shows the wiring pain is workforce's own API, FIX-2626 to FIX-2628 leave for a follow-up epic |

**What would change my mind:** the teammates proof (FIX-2622) showing that a better
`createWorkerInstallation` removes the wiring with no new unit. Then the objective is met by
views and resources alone, and kits wait for a second feature that needs them.

![D1: one epic for four changes, chosen, beside four epics in dependency order. Decides it: who shapes the pieces a kit holds. Price: twelve children and two spec stages. Flips if the wiring pain is workforce's own API](figures/d1-worth-it.svg)

It comes down to the kit: designed last in its own epic, it inherits a model it never shaped.

<a name="d2"></a>
## D2 · The build children are specced after the proofs, in a second spec-set PR

| | |
|---|---|
| **Instead of** | One spec set for all twelve children, written as soon as this spec merges (the standard [spec-set](../../../docs/contributing/orchestration.md#the-spec-set-one-pr-for-the-epics-issue-specs) path) |
| **Because** | Three of the build children rest on claims nobody has checked: a view can run with no session (`runRead.ts:33` takes a `sessionId`), declared dependencies can be checked, and a kit removes the host's wiring. A refuted premise after approval redraws up to six approved specs, the kit spec most of all |
| **Locks in** | Two spec-set PRs. **Stage 1:** FIX-2619 to FIX-2622, specced and built first. **Stage 2:** FIX-2551 and FIX-2623 to FIX-2628, specced together after stage 1 merges, with each proof's result recorded below. The closure's QA plan is written in stage 1 and reviewed while the rest build |

![D2: the build children specced after the proofs, chosen, beside one spec set for all twelve. Decides it: a refuted premise costs a note instead of redrawing approved specs. Price: a second spec-set PR. Flips if the proofs land before a set would be drafted anyway](figures/d2-prove-first.svg)

It comes down to a refuted proof: before the build specs it costs a note, after them six redraws.

<a name="d3"></a>
## D3 · Lab adapters stop growing at this epic's merge

| | |
|---|---|
| **Instead of** | Letting FIX-2592, FIX-2616 and FIX-2369's stacks 2 to 4 add verbs and rows to the labs' `adapter.ts` files until kits land |
| **Because** | Every verb added now is one more this epic deletes, and three open epics are about to add them. A need a screen has is already the package's to serve under FIX-2152 ER-4; this makes it a package read (a view once FIX-2623 lands), never an adapter verb |
| **Locks in** | [ER-8](#who-owns-what), held by the coordinator at those epics' spec reviews. Reads already in a package (FIX-2374 `sessionFeed`, FIX-2379's task-row view, FIX-2412 `watchRoster`) become views by rename, not by rewrite |

**What would change my mind:** those epics landing before stage 2 starts. Then their verbs are
counted into FIX-2628's estimate, not frozen.

![D3: lab adapters stop growing now, chosen, beside growing until kits land. Decides it: the lines this epic must delete stay at today's count. Price: sibling lab epics write a package read instead of a verb. Flips if those epics land before stage 2](figures/d3-adapter-freeze.svg)

It comes down to the delete count: each sibling verb added now is one more to remove later.

<a name="o1"></a>
## O1 · Open · Should FSD have kits: an installable unit above a flow?

**In plain terms.** A new top-level piece that bundles flows, views, resources, capabilities,
workers and a client half, configures itself through one config object, and plugs into other
kits through the slots they publish. Workforce becomes the first one, the coding harnesses the
second. An app installs them with `createFlowState({ kits: [...] })`
([example](examples/app-install.md)).

**The options.** *Kits:* the unit above, built last (FIX-2626). *No new unit:* fix workforce's own
installation API so the host's wiring goes, and keep each app's read model.

**The trade-off.** Kits turn FSD from parts an app assembles into features it installs, and they
are the only change that removes the adapters at the root: the client half ships with the kit.
But a kit is a new concept, slots are a contract that is hard to change later, and it touches
every app's setup. A capability can't do this job: it installs into one block and can't add
flows or views (`define-capability.ts`).

**My recommendation: yes,** after the teammates proof (FIX-2622) and after views and resource
addressing land, so a kit packages things that exist. Slots stay few, typed and published only
by the kit that owns the concept ([ER-5](#who-owns-what)).

**What would change my mind.** The proof showing the pain is mostly workforce's own API (the
circular callback), so a better `hireWorkforce` fixes it. Then fix workforce and wait for a
second kit.

**What being wrong costs.** Building kits first, with slots designed before a second kit exists,
freezes the wrong contract. Doing it last, against two kits, keeps that cheap.

![O1: kits, recommended after the teammates proof and views, beside fixing workforce's API. Decides it: only a kit's client half removes the adapters at the root. Price: slots are a new public contract. Flips if the proof shows the pain is workforce's own API](figures/open-kits.svg)

It comes down to the adapters: a better install API removes the wiring, never the read model.

<a name="o2"></a>
## O2 · Open · Should views replace flow reads? · revisits FIX-2286 D1

**In plain terms.** Rename `reads` to views and give them a scope (no session at user or org),
declared dependencies (the screen stays current without knowing topics) and keyed rows (a notice
can say which rows changed) ([example](examples/view.md)). `reads` and scope `derived` go, with
no alias (FIX-2447's rule).

**The options.** *Views, with a development-time check* that a view reads only what it declared.
*Keep reads and add a scope.*

**The trade-off.** With views, a client stops knowing topics and sessions, and "view" is the word
people already reach for. But `dependsOn` is declared by hand and can drift from what the block
really reads, and a drifted view silently misses changes. FIX-2286 D1's rule is kept either way:
one hook, storing nothing, refusing writes. Its condition ("nothing that does the same job is
added beside it") is why this is a rename and not a second definer.

**My recommendation: views,** with the check FIX-2621 proves. One word, with "read" retired as
the hook's name in the glossary.

**What would change my mind.** The check proving too costly to keep on. Then views without
`dependsOn` are reads with a scope, and the name "read" should stay. If FIX-2621 shows reads can
be recorded cheaply enough to run in production, dependencies could be inferred rather than
declared (as Convex's reactive queries do); that changes FIX-2623's design, not this answer.

**What being wrong costs.** Moderate. Four call sites and three read declarations exist today,
so the rename is cheap now and dearer with each app.

![O2: views with a dependency check, recommended, beside keeping reads with a scope. Decides it: the client knows only the view, no topics or session. Price: declared dependencies can drift. Flips if the check proves too costly](figures/open-views.svg)

It comes down to what the client must know: with a view, nothing but the view.

<a name="o3"></a>
## O3 · Open · Read stored resources directly, and write through the session that runs them? · generalizes FIX-1788

**In plain terms.** A user or org resource is read by scope and key with no session. A resource
can name the flow that runs it (`runBy`), with one session per resource (a dashboard) or one per
user (pins), and a client writes by sending that session an action
([example](examples/resource-runBy.md)).

**The options.** *Direct reads and `runBy` writes.* *A declared write rule* on the resource
(owner only, schema-valid) beside direct reads. *As today:* every resource addressed by a
session.

**The trade-off.** It settles the dashboard-versus-pins tension: writing belongs to a flow, but
reading user or org data shouldn't need its session. It is the general form of FIX-1788's worker.
Writes keep running in blocks, so FIX-1945's reason holds (a client write that skips the
validator). But the server now finds or makes a session from a resource: creation races,
deletes, and a resource whose flow is gone are new lifecycle to get right. The epic declines to
widen generic client writes; it does not retire today's session-scope `client.content.*` routes
(FIX-296).

**My recommendation: direct reads and `runBy` writes.**

**What would change my mind.** Most resources turning out to need no flow for writes. Then a
declared write rule earns its place beside `runBy`.

**What being wrong costs.** Low for reads, which are additive. Moderate for `runBy`: a wrong
session lifecycle shows as duplicate sessions, as it does today.

![O3: direct reads and runBy writes, recommended, beside a declared write rule and beside today. Decides it: validators and rules keep running in blocks. Price: find-or-make session lifecycle. Flips if most resources need no flow to write](figures/open-runby.svg)

It comes down to validators: a write rule is a second path that skips them.

<a name="o4"></a>
## O4 · Open · Ids on notices: accept the one-hour window? · revisits FIX-2428 D2, extends FIX-2367 D2

**In plain terms.** Notices say which ids changed, never what changed. A user whose access is
revoked could see which opaque ids change for up to an hour, but never read them.

**The options.** *Accept the hour,* and let any scope where timing alone is sensitive turn ids
off. *Re-check the socket every few minutes* instead of every hour (never a check per notice).

**The trade-off.** Targeted re-reads and much less traffic, against a small leak of timing and
ids. FIX-2428 D2 accepted the hour because notices were empty; FIX-2367 D2's rule (no rows, every
byte through a checked read) still holds. The reason a check per notice was refused (a store read
per notice per viewer) is kept.

**My recommendation: accept,** with the per-scope opt-out. FIX-2367 D2 and FIX-2428 D2 are
amended by this answer, before FIX-2466 builds further on no-row notices.

**What would change my mind.** A real tenant for whom ids or timing are themselves confidential.
Then shorten the re-check window to minutes.

**What being wrong costs.** Small: ids are optional, so turning them off anywhere is a config
change.

![O4: accept the hour with a per-scope opt-out, recommended, beside re-checking every few minutes. Decides it: what a revoked user learns, ids for up to an hour, never a row. Price: that leak. Flips if a tenant finds ids or timing confidential](figures/open-notice-ids.svg)

It comes down to what leaks: opaque ids for an hour, and never a row.

<a name="o5"></a>
## O5 · Open · What is the installable unit called?

**In plain terms.** Every candidate collides with something already in the repo or in readers'
heads. The word goes into the glossary, the API (`defineX`, `createFlowState({ xs })`) and the
published docs.

**The options, each with its collision.**

- **kit.** The glossary retires it in one sense only: FIX-2246's "Session factory… never a kit",
  whose check refuses `the kit` and `kit.x` in code and published pages. That entry narrows to the
  session-factory sense. FIX-1651 ("Eng workstream kit") and FIX-1649 D3 (a rejected "chrome kit
  each Lab imports") use it loosely in Linear and specs. Five files in packages, apps and labs
  use the word today.
- **extension.** File extensions (94 files mention the word), every editor's extension, and the
  objectives line "Plugin/extension ecosystem". It promises the third-party ecosystem the owner
  has ruled out.
- **pack.** `harness-manager` already holds a git pack of a run's work ("write the pack, then
  switch the record to it"), and npm has `pack`.
- **add-on.** Few collisions (three files), but it reads as optional and third-party, and
  `defineAddOn` is awkward.
- Rejected outright: *plugin* (the repo's Claude Code plugin in `plugins/`, build-tool plugins),
  *package* (npm, worker `PACKAGE.md`), *module* (JS modules, `resource-modules.ts`).

**The trade-off.** The cheapest word to adopt against the clearest promise. *Kit* costs one
narrowed glossary entry and promises "pieces that go together", with no store implied.

**My recommendation: kit.** FIX-2619 narrows the FIX-2246 entry and adds the new one in the same
PR, and the epic keeps "kit" as its working name until you answer.

**What would change my mind.** You reading *kit* as a starter template (a "starter kit"). Then
*pack*, whose one collision is internal.

**What being wrong costs.** Near zero now: a rename before any code ships. After FIX-2626 merges
it is a public rename under FIX-2447's no-alias rule.

![O5: kit, recommended, beside extension and pack. Decides it: what the word promises; extension promises the ecosystem the epic rules out. Price: a narrowed glossary retire. Flips if kit reads as a starter template](figures/open-unit-name.svg)

It comes down to the promise: *extension* invites the third-party ecosystem we ruled out.

## Who owns what

![Who owns what: ten rules by the children of FIX-2618 and the coordinator, each rule with exactly one owner, and the closure FIX-2629 checking every one](figures/ownership.svg)

Every rule has one owner; read a row to see where it is built and where it is only used. A
*uses* cell is a place a child must not decide again. The three proofs own no rule: they feed
the stage-2 specs.

| # | Rule every child obeys | Owner | Checked at |
|---|---|---|---|
| ER-1 | One hook computes an answer for a screen: the view. `reads` and scope `derived` go with no alias; nothing that does the same job is added beside views | FIX-2623 builds · FIX-2551, FIX-2627, FIX-2628 use | The stage-2 cross-spec review; the closure |
| ER-2 | A view never writes (its context refuses writes and dispatch, as a read's does today). Every byte a client sees comes through a checked read or view; a notice carries ids, never rows | FIX-2623 builds · FIX-2624, FIX-2625 use | Each child's spec review; the closure |
| ER-3 | A session-free read or view takes user and org from the verified principal, never from the body, query or headers (BP-031) | FIX-2624 builds · FIX-2623 uses | FIX-2623's and FIX-2624's spec review |
| ER-4 | No generic client write is added. A client writes a user or org resource only by sending an action to its `runBy` session; session-scope `client.content.*` stays as it is | FIX-2624 builds · FIX-2626, FIX-2628 use | The stage-2 cross-spec review |
| ER-5 | A kit holds only existing pieces (flows, views, resources, capabilities, blocks, workers, a client half, config, slots). It reaches another kit only through slots that kit publishes, never patches one, and a host can turn off what it contributes. Slots are few, typed, and published only by the kit that owns the concept | FIX-2626 builds · FIX-2627, FIX-2628 use | FIX-2627's spec review; closure leg b |
| ER-6 | Data the server computes is typed by its view's output schema (`ViewOutput`). An app hand-writes only what its screen computes | FIX-2623 builds · FIX-2627, FIX-2628 use | FIX-2628's spec review; closure leg a |
| ER-7 | One live read in the client: the coalescer and the path rule live in one place, and `useView` and every package watch sit on it | FIX-2551 builds · FIX-2623, FIX-2627 use | The stage-2 reuse review |
| ER-8 | No lab adapter grows from this epic's merge. A screen's new need is a package read or view, never a new adapter verb or hand-written row type ([D3](#d3)) | The coordinator · FIX-2628 uses | FIX-2592, FIX-2616 and FIX-2369's spec reviews |
| ER-9 | Every public name the set fixes is in the glossary in the PR that coins it; "read" retires as the hook's name; the unit's name waits for [O5](#o5) | FIX-2619 builds · FIX-2623, FIX-2626 use | Each child's PR checks |
| ER-10 | Ids on notices are hints. No ids means read everything; a full read runs on connect, reconnect, resync, a poll tick and wherever the bus doesn't cross processes; a notice that drops the resource name carries no ids | FIX-2625 builds · FIX-2623 uses (keys) | FIX-2625's spec review; the closure |

## Coordination seams

| Seam | Between | Rule |
|---|---|---|
| `defineFlow`'s config (`reads` → `views`) and the export ratchet | FIX-2623, FIX-2626, FIX-2447 | FIX-2623 removes `reads` with no alias; `defineView`, `useView`, `fsd.resource` and `defineKit` enter FIX-2447's ratchet in the PR that adds them |
| The client's live read and `client.subscribe` | FIX-2551, FIX-2623, FIX-2625, FIX-2367 | FIX-2551 lands the coalescer; FIX-2623 builds `useView` on it; FIX-2625 adds keys to it. None adds a topic or a poll (FIX-2367 ER-2, ER-3) |
| The engine's read routes and the endpoint table | FIX-2623, FIX-2624, FIX-2619 | The view route and the scope-addressed resource routes land in their children; FIX-2619's table is updated by whichever lands second |
| The resource definition (`client` config, `runBy`) | FIX-2624, FIX-2626, FIX-2628 | FIX-2624 owns the fields; a kit and the app kit only declare them |
| The workforce roster watch | FIX-2412, FIX-2623, FIX-2627 | FIX-2623 moves it onto a view; FIX-2627 ships that view in the workforce kit |
| The coding worker flow | FIX-2627, FIX-1907, teammates' `coder.ts` | FIX-2627 merges the two labs' routing into one flow; FIX-1907's harness session flow factory feeds it, and lands first |
| The glossary | FIX-2619, FIX-2623, FIX-2626, FIX-2600 | FIX-2619 adds the entries and narrows FIX-2246's; later children edit their own entry in their PR (FIX-2600 ER-2) |
| `runBy` and per-service sessions | FIX-2624, FIX-2471 | FIX-2471's webhook subscriptions are a candidate consumer. Coordinate, don't fold |
| Connectors and project scope keys | FIX-2627, FIX-2615 | A connector looks like kit config; FIX-2615 defines what a project is. FIX-2627 reads FIX-2615's answer and doesn't define one |

## Decided while drafting, recorded so no child reopens them

Engineering calls, carried from the design review where they were decided without asking:

- **No separate view definer beside reads.** A view is the rename of a read, never a second hook.
- **Notice ids are hints.** A full read is always the fallback.
- **No generic client writes.** Phrased precisely: the epic declines to widen them; the existing
  session-scope `client.content.*` routes (FIX-296, with grants) stay, and FIX-1945's rules
  record keeps client writes off.
- **The concept doc comes first,** and names wait for the glossary.
- **FIX-2551 is a child, not absorbed.** It already says what it delivers; FIX-2623's `useView`
  builds on it.
- **FIX-2036's deferred "Workforce browser contract for Shift Manager reads"** (overlapping
  FIX-1672) is this epic's workforce kit client. It is folded, not filed again.
- **Out of the set, as follow-up epics filed at wrap:** moving Teammates' and Shift Manager's
  remaining adapters onto kit clients, and serving each answer on one route only (session
  expose and collection `clientData` served twice; the manifest against the snapshot; four React
  resource hooks no app calls).
- **Sequenced after this epic:** FIX-2430. **Unrelated:** FIX-2490, FIX-1637, FIX-2331,
  FIX-2440, FIX-2273, and FIX-2092 apart from its loose use of "view".
- **Related, not parented:** FIX-844, FIX-1672, FIX-1698 (the workaround FIX-2624 removes),
  FIX-1454, FIX-2065, FIX-2043 (already under FIX-2036), FIX-2326, FIX-2556.

## What the end-state POC showed

None built at create. The three proofs that the division rests on are children (FIX-2620 to
FIX-2622), and [D2](#d2) puts them before any build spec. Each one's result is recorded here, in
four lines, by the amendment that lands it.

## Analysis

### Analysis — FIX-2618 epic spec · 2026-11-08 · watermark 2026-11-08

Run inline by the author with the reuse review: this dispatch had no sub-agent tool, so it is not
the fresh, independent analyst the skill asks for. The stage-1 spec-set review runs a fresh one.

**Verdict:** right approach, with one finding recorded for FIX-2621 and O2. No fold changed the
objective or the division.

1. **Reuse.** Views **extend** reads; `derived` is removed. `runBy` **extends** FIX-1788's worker,
   and a send is an ordinary action, so no write route. Session-free identity **reuses** the
   principal push topics already use. Ids **extend** the notice. The coding worker flow
   **merges** two copies. `defineKit` is **genuinely new**: a capability installs into one block.
2. **Prior art.** [Django apps](https://docs.djangoproject.com/en/5.1/ref/applications/) and
   [Rails engines](https://guides.rubyonrails.org/engines.html): one installable unit carrying
   models, views, routes and config, the kit's shape. [Fastify plugins](https://fastify.dev/docs/latest/Reference/Plugins/)
   declare `dependencies` and expose decorators, as `requires` and slots do. [NestJS modules](https://docs.nestjs.com/modules)
   export only what others may use. [Convex queries](https://docs.convex.dev/realtime) infer the
   read set at run time instead of declaring it.
3. **Other shapes.** Four epics in order ([D1](#d1)); no kit, a better install API ([O1](#o1),
   FIX-2622 tests it); inferred dependencies (the Convex shape, recorded below); a write rule on
   the resource ([O3](#o3)).
4. **New factors.** FIX-2466 is building on no-row notices now, so [O4](#o4) is time-bound.
   FIX-2447's export ratchet and FIX-2600's glossary are live; both are seams above.
5. **Necessity.** Yes at this size, with FIX-2622's collapse trigger. The leaner set drops
   FIX-2625; it is gated instead.
6. **Ergonomics.** Four new words (view, kit, slot, `runBy`) and one retired (read as a hook).
   A resource gains a second field about clients (`runBy` beside `client`), which a newcomer must
   learn are read and write halves.
7. **Concerns.** `runBy` session lifecycle; slots freezing early, held by building them last
   against two kits; the size of one closure run.

| Finding | Objective | Changes the approach? | Disposition |
|---|---|---|---|
| Convex infers a query's read set; FIX-2621's recording could make `dependsOn` inferred, not declared | 2, 3 | Not the objective; it may change FIX-2623's design | Recorded in O2 and for FIX-2621 |
| FIX-2551 should stay its own child rather than be absorbed by FIX-2623 | 1 | No | Folded into the set |
| FIX-2036's deferred Shift Manager browser contract is the workforce kit's client | 1 | No | Recorded above |

## How it got here

- **Design review (2026-11-08)** — the read-and-write surface review mapped eight read paths and
  problems A to F, and proposed views, resource addressing, notice ids and kits together. Its code
  sketches are carried as [`examples/`](examples/).
- **Owner scope (2026-11-08)** — kits are in scope as FSD's own composition unit; a third-party
  ecosystem stays out. Sign-offs on FIX-2286, FIX-2367 and FIX-2428 may be reopened.
- **Drafted (2026-11-08)** — one epic in two spec stages; twelve children; five open holds.

**Open:** [O1](#o1) · [O2](#o2) · [O3](#o3) · [O4](#o4) · [O5](#o5).
