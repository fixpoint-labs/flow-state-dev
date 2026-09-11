# FIX-1351 — W3: File-convention surface (channels/resources/skills) + thin pentest lab Proof

*Everything here is transcribed from the record — [FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351) /
[#1703](https://github.com/fixpoint-labs/flow-state-dev/issues/1703), its comments, the sub-spec
PRs, and the owner's two rewrites of 2026-09-11 on this PR. Where the record does not settle
something, §5 says so and names who decides, rather than filling the gap with a plausible answer.*

## 1. Purpose & objective *(the gated sign-off surface)*

**The objective, as the PM and Architect agreed it on 2026-09-10.** Quoted from FIX-1351, not
re-composed:

> **Published objective.** Goal 1 — Workforce foundation honesty / multi-seat real usage (file
> conventions + lab Proof; MCP held).
>
> *PM + Architect agreed 2026-09-10. Not a D-n.*

The desired outcome that objective was agreed against, also quoted:

> **W3 — File-convention surface + thin pentest lab Proof**
>
> * File conventions for **rooms**, **L2 channels** (sessions/boards — not Channel L1),
>   **resources**, and **skills**
> * Thin **pentest lab** Proof that exercises the conventions
> * [FIX-1342](https://linear.app/fixpoint-labs/issue/FIX-1342) rewritten: kill `worker.ts` as
>   `WorkerManifest` / framework runtime-import; seats stay `WORKER.md`; custom kinds = flow
>   factories in a kinds map

**Two things in that quote were superseded by the owner on 2026-09-11** ([rewrite](https://github.com/fixpoint-labs/flow-state-dev/pull/1718#issuecomment-5638262951)), and the
quote is left as agreed rather than edited: the product noun is **channel**, not room, and the
first bullet's "rooms" and "L2 channels" are **one** convention rather than two. Every later
occurrence of "room" in this document is either inside a quotation or names a thing that predates
the rename. §3 carries the floor as it now stands.

**The problem it answers**, quoted from the same description: *"W2 landed the worker loader +
seat factory spine. Apps still lack a file-convention surface for the rest of a Workforce —
rooms, L2 channels (as sessions/boards), resources, and skills — and have no thin lab Proof that
the conventions hold under real multi-seat pressure."*

**Invent kill**, as the owner restated it on 2026-09-11: no **`MessageBoard` L1 package type**
(a Flow/Session peer); no **`Channel` L1 substrate type**; no TeamFlow L1; no framework
runtime-import of seat `worker.ts` as a WorkerManifest path.

**The board *concept* is not killed — only the package type is.** It ships as named L1
composition, ahead of L2 channels (§3 item 0): *"composition over existing collection / `reactTo`
/ `dispatcher`."* A slogan reading "no MessageBoard" without **L1 package type** is the old
wording and is now wrong. The `Channel` L1 substrate kill is unchanged and unqualified.

**Held / out** (quoted): MCP ([FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333)) is
held and is not this epic's door; Collab RC is later — the channels lock from
[FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) feeds W3's channels convention, not
full Collab; W3 does **not** nest under [FIX-1332](https://linear.app/fixpoint-labs/issue/FIX-1332)
(W2 — prior, not parent). The 2026-09-11 cut re-states the held list and adds to it — §3, "Still
held".

**Holistic necessity — not re-derived here.** The record contains no holistic-necessity pass at
epic altitude, and this document is not the place to invent one after the sub-specs converged
against the floor as agreed. The one challenge to the set's composition that did exist —
FIX-1353's fold — **has now been answered by the owner**, in a different shape than it was
proposed (§3). §5 keeps the standing question that *is* a necessity question: every W3 convention
is still built before its only consumer. It is unanswered because nobody has answered it.

## 2. Themes & long-horizon direction

### Theme 1 — The inherited shape rules. This is their canonical home.

Seven rules govern all four conventions. They originated as a seven-point block in FIX-1352's
spec; that block was deliberately removed before review closed and **replaced by a pointer to its
canonical sources** — the shipped `WORKER.md` pair
(`packages/workforce/src/loader/read-workforce-directory.ts` and `hire.ts`) plus the atlas §06
tree — so the spec would not carry a copy that goes stale when the originals move. The numbered
form then survived only inside
[FIX-1354 §7's inheritance table](https://github.com/fixpoint-labs/flow-state-dev/pull/1715),
which is a table inside one of the specs the rules govern. **They live here now.** A convention
deviates from one only with a stated reason in its own spec.

| # | Rule | Status |
| --- | --- | --- |
| 1 | Path `teams/<id>/<slot>/<name>/THING.md` — folder per thing, fixed uppercase manifest filename | As inherited |
| 2 | Identity `<teamId>.<name>`, dot-joined, minted in one helper via the shared segment validator | As inherited |
| 3 | One shared frontmatter dialect from `orchestration`; no second dialect | As inherited |
| 4 | `description` required; unknown frontmatter keys carried verbatim into the declared bag | **Corrected** — the refusal clause (*"at most one key refused by name"*) is replaced by theme 2 |
| 5 | `{ things, errors }`; per-entry problems collected; structural folders reported under their own path; throw only on an unreadable root | As inherited |
| 6 | The reader touches `node:fs` behind `./loader`; what turns records into something usable stays isomorphic at the package root | As inherited |
| 7 | Two sources for one thing is a refusal, not a precedence rule | **Corrected** — the second clause (*"framework-granted status is derived from the declaration path, never declared in the file"*) is replaced by theme 2 |

Rules 1 and 2 are **broken by FIX-1354 with stated reasons** — file-per-thing at
`<slot>/<name>.md` with two roots rather than one, and a path-form ref `teams/<teamId>/<name>`
that the atlas has already fixed. That is the rule set working as intended: a stated deviation,
not drift.

### Theme 2 — The corrected rule, and the three mechanisms that discharge it

**Folded verbatim** from the correction recorded on
[FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351#comment-ec11496a) on 2026-09-11, which
is verified against source. It is reproduced unaltered rather than paraphrased — **including its
"rooms", which predates the same day's rename and means today's *channel*.** Renaming inside a
verified quotation would cost more than the inconsistency does.

---

**Cross-cutting correction — inherited rules 4 and 7.** Raised from FIX-1354's spec review ([#1715](https://github.com/fixpoint-labs/flow-state-dev/pull/1715)); the numbered list this corrects is the one FIX-1354 §7 tabulates from FIX-1352's original seven-point block.

Rules 4 and 7 as this epic inherits them misdescribe the shipped `WORKER.md` convention that every W3 convention is mirroring. Rule 4 says unknown frontmatter keys pass through verbatim and a convention refuses at most one key by name. Rule 7 says a status the framework grants is derived from the declaration path, never declared in the file. The precedent runs **three** policies at once, not one:

| keys | behaviour | evidence |
|---|---|---|
| `flow`, `description` | **consumed and stripped** from the settings bag | `packages/workforce/src/hire.ts:30` (`RESERVED_KEYS`), `:83-86` (`settingsOf`) |
| `persona` (pre-rename); `instructions` alongside a body | **refused by name** | `hire.ts:144` (refused key), `:151-158` (two-sources refusal) |
| everything else | verbatim into `declared` | `packages/workforce/src/manifest.ts:12-27` |

**The corrected rule, replacing "at most one refused key":**

> **A key the convention *consumes* is stripped. A key the convention *derives* is refused.**

Rules 4 and 7 collapse into that one line. "At most one refused key" was never true of the precedent, and rule 7's "declaration path" is one derivation source among several — the folder name, the Markdown body and the directory walk are others.

Two points make it actionable rather than a slogan.

**1. It is a set, not a key.** A convention refuses the whole set of fields it derives, and applies derivation *after* any allowlisted passthrough, so an ordering slip cannot corrupt a row either. FIX-1354 hit the consequence live: with a passthrough that merged into the same object as the derived fields, a `ref:` entry redirected the storage row, `content:` replaced the body, and a YAML `stateSchema:` string **constructed successfully** (`typeof === "string"`) and failed only later at `safeParse` — a benign value indistinguishable from a legitimate one (#1715 §10, F1a–F1c).

**2. Three mechanisms discharge the rule. Reach for them in this order.** Every convention is subject to the rule; what differs is which mechanism covers each field it derives.

1. **Shape — the first defence.** Put the derived field in a slot *sibling* to the passthrough bag. `WorkerManifest` is `{ id, declared, body }`, so the derived identity lives beside the bag: a frontmatter `id:` lands in `declared` and cannot overwrite the minted id. Skills does the same with `name` (from the folder) and `files` (from the walk) — frontmatter only ever becomes state, so those share no destination with a declared key. Structurally unreachable; nothing to refuse. A convention that flattens derived fields into the passthrough bag gives this up and must then refuse explicitly, so pick the shape deliberately.
2. **Ordering.** Derive after the passthrough, so the framework's value wins. Skills' `_seededAt` *does* share the flat state bag but is written after the parse; resources applies its derived fields last, over an allowlisted passthrough.
3. **Explicit refusal.** When a derived field lands where a declared key can reach it and neither of the above applies: rooms' `system:` (FIX-1352), skills' newly derived `scope:` (FIX-1356), resources' full derived set — `scope`, `ref`, `stateSchema`, `default` and the content sources (FIX-1354).

The check for the next convention: **find each field you derive, and name which of the three protects it.**

**No sibling spec changes follow from this.** Rooms (FIX-1352), resources (FIX-1354) and skills (FIX-1356) are all already consistent with the corrected rule — skills' `scope:` refusal is the rule applied, not an extra. This is a wording fix to the epic, not a change request to them. The FSD Architect independently routed the general form here on #1715 and said explicitly not to patch the sibling specs from that PR.

---

### Theme 3 — What is channels-specific and must not be copied

From FIX-1352, stated here so the other conventions do not cargo-cult it: the refused `system:`
key and the **either-source** rule behind it exist because channels have two declaration sources
and a later deletion guarantee. A convention with one source needs neither, and adding them for
symmetry is cargo cult. FIX-1354 already declined both on exactly that basis.

### Theme 4 — No parameterised slot reader

FIX-1352 left a follow-up: when the third convention is built, revisit whether the shared walk
should become a parameterised slot reader. **FIX-1354 §3 answers it — no**, and carries the
argument. Conventions consume the walk primitives FIX-1352 extracts (`classify`,
`openStructuralDirectory`, the symlink and unreadable wordings, `IGNORED_ENTRIES`, the segment
validator) rather than a generalised reader. This matters most for skills (FIX-1356), which is
slot-shaped and would otherwise be built to a generalisation that has already been disproved.

## 3. The epic floor

**Rewritten 2026-09-11 to the owner's cut**, posted here as two comments minutes apart — the
[owner rewrite](https://github.com/fixpoint-labs/flow-state-dev/pull/1718#issuecomment-5638262951) and the [Cycle PM cut](https://github.com/fixpoint-labs/flow-state-dev/pull/1718#issuecomment-5638301871) that narrows it. Both are quoted below wherever
they decide something. The floor FIX-1351's description originally agreed is preserved at the end
of this section, because two of its six items no longer exist in that form.

### The floor as it now stands

| # | Item | Issue | Note |
|---|---|---|---|
| 0 | **Message board — the minimal notify door** | [FIX-1311](https://linear.app/fixpoint-labs/issue/FIX-1311) / [#1565](https://github.com/fixpoint-labs/flow-state-dev/issues/1565) | **First, and the only blocking item.** L1 *composition* on today's doors — a topic-scoped resource collection, subscribers in collection state, `reactTo` on a new row, a router over **declared** dispatchers. No `MessageBoard` L1 package type |
| 1 | **Channels file convention** | [FIX-1352](https://linear.app/fixpoint-labs/issue/FIX-1352) | One L2 file type. Absorbs what were floor items 1 and 2 |
| 2 | Resources file convention | [FIX-1354](https://linear.app/fixpoint-labs/issue/FIX-1354) | Unchanged |
| 3 | Skills file convention | [FIX-1356](https://linear.app/fixpoint-labs/issue/FIX-1356) | Unchanged |
| 4 | Thin pentest lab Proof | [FIX-1355](https://linear.app/fixpoint-labs/issue/FIX-1355) | Last. The first consumer of any of it |
| 5 | Kinds-map fence — not `worker.ts` hire | [FIX-1342](https://linear.app/fixpoint-labs/issue/FIX-1342) | Unchanged |

**Item 0 is the door, not the board.** The scope is quoted, because the difference is the whole
point of the second comment:

> W3 floor pre-req is the **minimal notify door** of FIX-1311 / #1565 (collection + subscriptions
> + `reactTo` + declared dispatchers — #1627 shape), **not** the full board PRD.

[#1627](https://github.com/fixpoint-labs/flow-state-dev/pull/1627) is the throwaway lab that ran
exactly that path on today's doors and closed. It is what "the #1627 shape" names, and it is why
this item is a sequencing call rather than a research one.

**Phased behind the door — blocking nothing.** Brief, housekeeper, retirement and CAS: the rest
of FIX-1311's board PRD. Quoted: *"do not block channel file conventions / resources / skills /
lab."* They stay in the epic, after the door. **Only the door carries a blocking edge**, and it
carries it to item 1. Treating the whole of FIX-1311 as the gate would hold three issues the cut
exists to free — the single most expensive way to read this section wrong.

**Still held — recorded, not scheduled.** Dynamic addresses; cross-flow; Collab RC /
[FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341); MCP
([FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333)) until the lab.

### Channel replaces room

Quoted from the owner rewrite:

> * Product word = **channel** (DM + group approachability).
> * One L2 file type (prefer `CHANNEL.md`); fold the old "rooms" + "L2 channels" dual into **one**.
> * "Room" is at most a channel *kind* / flavor later — not a parallel noun on the epic floor.

This settles the fold that the previous revision of this section carried as *pending the owner's
stamp*, **and it settles it in a different shape than that edit proposed.** The proposal was
arithmetic — delete floor item 2, four conventions become three. The answer is a noun: **channel
absorbs room**, one word and one file type, **and** FIX-1311's door joins the floor ahead of
everything. W3 does finish as three file conventions plus the lab, but that count is now a
consequence of the rename, not the decision itself.

**`CHANNEL.md` is preferred, not fixed.** "Prefer" is the owner's word; FIX-1352 owns the
filename. Everything else in this subsection is settled.

### The floor as originally agreed — superseded, kept for reference

> 1. Rooms file convention (system + dynamic; either-source — [FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) lock)
> 2. L2 channels as sessions/boards
> 3. Resources file convention
> 4. Skills file convention
> 5. Thin pentest lab Proof
> 6. [FIX-1342](https://linear.app/fixpoint-labs/issue/FIX-1342) — kinds-map fence (not worker.ts hire)

Its items 1 and 2 are now the one channels convention; item 0 above is new.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| FIX-1311 | **Message board — the minimal notify door**: collection + subscribers in state + `reactTo` + declared dispatchers | spec | — | — | Backlog — **first on the floor, and not started** |
| FIX-1342 | Kinds-map fence — seats stay `WORKER.md`; custom kinds are flow factories | spec | [#1702](https://github.com/fixpoint-labs/flow-state-dev/pull/1702) *(closed at approval)* | [#1712](https://github.com/fixpoint-labs/flow-state-dev/pull/1712) *(draft)* | Spec Approved |
| FIX-1352 | Channels file convention (either-source; declaration-only) | spec | [#1711](https://github.com/fixpoint-labs/flow-state-dev/pull/1711) | — | In Spec Review |
| FIX-1353 | *L2 channels fold* — being **closed as a duplicate** of the channels convention | — | [#1714](https://github.com/fixpoint-labs/flow-state-dev/pull/1714) | — | Closing |
| FIX-1354 | Resources file convention | spec | [#1715](https://github.com/fixpoint-labs/flow-state-dev/pull/1715) | — | In Spec Review |
| FIX-1355 | Thin pentest lab Proof | spec | — | — | Backlog |
| FIX-1356 | Skills file convention | spec | [#1716](https://github.com/fixpoint-labs/flow-state-dev/pull/1716) | — | In Spec Review |
| FIX-1357 | Kinds + blocks boot scan (file-convention registration) | spec | — | — | Backlog |
| FIX-1358 | Atlas: channel replaces room (one convention + board pre-req) | *unset* | — | — | Backlog |

Five things this table does not say on its own:

- **FIX-1311 carries the `Feature` label**, so its route is `spec` and its spec is unwritten. The
  critical-path item is the one with the least done to it.
- **FIX-1352's Linear title already reads *Channels file convention*; #1711's PR title still reads
  *Rooms*.** The rewrite is in flight as this is written, by another agent.
- **FIX-1353 closes as a duplicate, but its one unowned item does not close with it.** The pre-lab
  intake DM is rehomed onto FIX-1311 and is carried in §5. It is the only genuinely unowned thing
  this epic found, and a reshuffle is exactly how such a thing disappears.
- **FIX-1358 is unlabelled**, so its route is unset and its blank Spec PR cell records an
  unanswered question rather than a `direct` route. Whoever labels it settles that.
- **Linear nesting and `blockedBy` belong to the Linear Manager**, per the owner's own comment. As
  of this writing Linear already nests all nine under FIX-1351 and records FIX-1311 `blocks`
  FIX-1352 / FIX-1353 / FIX-1358 — at whole-issue granularity, where the cut above says only *the
  door* blocks. Recorded here for the Linear Manager; not changed from this document.

## 5. Open cross-cutting questions

Raised by the sub-specs commenting up, or by the record itself. None of them blocks the objective
gate.

- **Skill names are globally unique across an app's teams — is that good enough for the lab
  Proof?** Raised by FIX-1356, explicitly as the epic's call and not the issue's. Skills seed into
  one collection keyed by the bare skill name, and the record that reaches it carries no team, so
  two same-named skills have nowhere to both exist. The genuine options are refuse loudly or
  overwrite silently (today's behaviour); a precedence rule was never available, since it would
  only be choosing which declaration gets clobbered. Decision 3 refuses loudly. **The
  consequence: a team cannot name a skill `review` if any other team already has one** — a team
  folder buys ownership a human can see and a level an app can choose to load, not a namespace.
  **This contradicts what the atlas leads a reader to expect:** the atlas gives
  `teams/<id>/resources/` an explicit *"org + team key"*, but gives `teams/<id>/skills/` only
  *"same `SKILL.md` wiring, this team"* — a mechanism with no team dimension at all, which reads
  as ownership-with-isolation and delivers ownership only. If the answer is no, the fix is
  per-team skill identity, which FIX-1356's Decision 1 deliberately forecloses (the shipped name
  validator refuses the dot-joined form) and which is a much larger issue. **Decides:** the owner.
  **Blocks:** nothing, but FIX-1356's spec approval turns on it.

- **The pre-lab static intake DM now has a home, and needs a side of the phase line.** Raised by
  FIX-1353 §8 step 4, which searched and found no covering issue at all. With FIX-1353 closing as
  a duplicate, the item is **rehomed onto FIX-1311** — it is the one genuinely unowned thing this
  epic found, and it must not disappear in the reshuffle. What the rehoming does *not* settle is
  which side of the 2026-09-11 cut it falls on: **the minimal notify door**, which is on the
  critical path and blocks the channels convention, or the **phased-behind** half (brief,
  housekeeper, retirement, CAS), which blocks nothing. The lab needs the DM before Collab opens,
  so parking it behind the phase line quietly makes it the lab's problem instead. The session
  route ships and only the helper is unwritten — the atlas's `openDm` is a proposal, not an issue.
  **Decides:** the owner, with the Architect — it is a scoping call on their own cut. **Blocks:**
  nothing today; FIX-1355 if it is still unplaced when the lab starts.

- **Every W3 convention is still built before its only consumer.** Raised by FIX-1353 §12;
  FIX-1352's Decision 1 names the same thing for the channels convention in particular (*"rooms is
  also the least useful of the four to ship alone"*). The lab (FIX-1355) is sequenced last and is
  the first thing that would declare a channel, resource, or skill in files. **The 2026-09-11
  floor rewrite does not answer this**, and is easy to misread as having done so: it puts the
  message-board notify door first, which gives the channels convention a *mechanism* to bind, not
  a *consumer* that declares one in a file. **Decides:** the owner — it is a sequencing call on
  the floor. **Blocks:** nothing today.

- **Collection-vs-N-singles row compatibility at the resources ref form is unclaimed.** Raised by
  FIX-1354 §12. The atlas's worked shape for team documents is
  `defineResourceCollection({ pattern: "teams/[teamId]/[doc]", scope: "org" })` — one
  parameterised collection, not N singles. FIX-1354 installs singles **at that same ref form**, so
  the keys do not diverge, but the install shapes differ and **row-compatibility between them is
  explicitly unverified**. Whoever moves documents onto a collection settles it first; no issue
  owns that today. **Decides:** unassigned — it needs an owner. **Blocks:** nothing in W3.

- **The three conventions will not be symmetrical, and the epic should say so once.** Raised by
  FIX-1356, before the fold; it named four. Channels and resources are new and share a shape;
  skills are older, external, and do not — FIX-1352 already anticipated it (*"it is evidence the convention shape is real. It
  is not shared code"*). Recording the intended end state is what stops the next reader filing it
  as drift. FIX-1354 adds a second asymmetry the same sentence has to cover: three conventions are
  folder-per-thing, resources is file-per-thing — with three conventions rather than four, that is
  now two against one. **Decides:** the epic's docs pass owes the sentence; nobody has written it.
  **Blocks:** nothing.

- **The consumer reshape.** Raised by FIX-1353 §3 as the strongest alternative use of its own
  slot: give the channels convention its missing consumer — one helper that opens a session for a
  declared channel. Buildable on today's APIs, and the 2026-09-11 cut moves it closer by putting
  the notify door on the floor, but a session-opening helper is still on the Collab side of the
  fence the Architect has cleared twice. Raised rather than absorbed. **Decides:** the owner.
  **Blocks:** nothing.

- **~~Rooms and L2 channels may be one convention.~~** *Closed 2026-09-11.* They are one, and the
  one is called a **channel**. Raised by FIX-1352 §12 commenting up; answered by FIX-1353's
  Decision 1; settled by the owner's rewrite on this PR, which chose the noun as well as the
  count. Applied to the floor in §3 — no stamp is outstanding.

---

## Epic evolution

- **Epic-spec stood up (late)** — four sub-specs had already converged with no epic document and
  no `epic/*` branch. Transcribed from FIX-1351, #1703 and the four spec PRs; nothing composed.
  The inherited shape rules got a canonical home (theme 1), the rule-4/7 correction was folded
  verbatim (theme 2), and the channels fold plus FIX-1355's scope line were recorded as pending
  the owner's stamp rather than applied.
- **Floor rewritten to the owner's 2026-09-11 cut** — two comments on this PR, the second
  narrowing the first. FIX-1311's **minimal notify door** joins the floor first and is the only
  blocking item; the rest of its board PRD is phased behind it and blocks nothing. **Channel
  replaces room** as the product noun, folding the old rooms/L2-channels dual into one file type.
  The invent-kill slogan is corrected to no MessageBoard **L1 package type** — the concept ships
  as named L1 composition — while the `Channel` L1 substrate kill stands unchanged. The pending
  stamp in §3 is gone: it was answered in a different shape than it was written, so the section
  was rewritten rather than ticked off.
