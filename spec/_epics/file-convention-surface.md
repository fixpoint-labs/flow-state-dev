# FIX-1351 — W3: File-convention surface (rooms/channels/resources/skills) + thin pentest lab Proof

*Stood up after four sub-specs had already converged. Everything here is transcribed from the
record — [FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351) /
[#1703](https://github.com/fixpoint-labs/flow-state-dev/issues/1703), its comments, and the four
spec PRs. Where the record does not settle something, §5 says so and names who decides, rather
than filling the gap with a plausible answer.*

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

**The problem it answers**, quoted from the same description: *"W2 landed the worker loader +
seat factory spine. Apps still lack a file-convention surface for the rest of a Workforce —
rooms, L2 channels (as sessions/boards), resources, and skills — and have no thin lab Proof that
the conventions hold under real multi-seat pressure."*

**Invent kill** (quoted): no Channel / MessageBoard L1; no TeamFlow L1; no framework
runtime-import of seat `worker.ts` as a WorkerManifest path.

**Held / out** (quoted): MCP ([FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333)) is
held and is not this epic's door; Collab RC is later — the rooms lock from
[FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) feeds W3's rooms convention, not full
Collab; W3 does **not** nest under [FIX-1332](https://linear.app/fixpoint-labs/issue/FIX-1332)
(W2 — prior, not parent).

**Holistic necessity — not re-derived here.** The record contains no holistic-necessity pass at
epic altitude, and this document is not the place to invent one after four specs have converged
against the floor as agreed. The one challenge to the set's composition that does exist —
FIX-1353's fold — is carried in §3 as a pending stamp rather than applied. §5 carries the
standing question that *is* a necessity question: every W3 convention is built before its only
consumer. It is unanswered because nobody has answered it.

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
is verified against source. It is reproduced unaltered rather than paraphrased.

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

### Theme 3 — What is rooms-specific and must not be copied

From FIX-1352, stated here so the other conventions do not cargo-cult it: the refused `system:`
key and the **either-source** rule behind it exist because rooms have two declaration sources and
a later deletion guarantee. A convention with one source needs neither, and adding them for
symmetry is cargo cult. FIX-1354 already declined both on exactly that basis.

### Theme 4 — No parameterised slot reader

FIX-1352 left a follow-up: when the third convention is built, revisit whether the shared walk
should become a parameterised slot reader. **FIX-1354 §3 answers it — no**, and carries the
argument. Conventions consume the walk primitives FIX-1352 extracts (`classify`,
`openStructuralDirectory`, the symlink and unreadable wordings, `IGNORED_ENTRIES`, the segment
validator) rather than a generalised reader. This matters most for skills (FIX-1356), which is
slot-shaped and would otherwise be built to a generalisation that has already been disproved.

## 3. The epic floor

**Quoted verbatim from FIX-1351's description.** This is the agreed floor. The two items below it
are *not* applied.

> 1. Rooms file convention (system + dynamic; either-source — [FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) lock)
> 2. L2 channels as sessions/boards
> 3. Resources file convention
> 4. Skills file convention
> 5. Thin pentest lab Proof
> 6. [FIX-1342](https://linear.app/fixpoint-labs/issue/FIX-1342) — kinds-map fence (not worker.ts hire)

### Pending the owner's stamp — proposed, not applied

**Neither edit has been made**, which is why the floor above still reads as it was agreed.

**(a) The channels fold collapses floor items 1 and 2 into one.** FIX-1353's Decision 1 concludes
that rooms and L2 channels are one thing named twice: the FIX-1341 rooms lock defines a room as
what *"binds existing L1 sessions / boards / dispatch"*, and FIX-1353 defines a channel as what
*"composes as sessions/boards over existing dispatch"* — one predicate, two spellings, and the
atlas calls its four channel kinds **rooms**, the direct-message case included. FIX-1353
therefore ships no `CHANNEL.md`, no reader, no `channels/` folder, and no production code. Its
Decision 2 keeps the *composition* half on FIX-1311 and FIX-1341 — on a scope call, not a
capability one: the same-flow group is marked *exists* on the atlas and the session-opening
helper is buildable today. **Proposed floor edit** (FIX-1353 §8 step 2): item 2 is removed and
item 1 becomes the rooms/channels convention, so **W3 becomes three file conventions plus the
lab**, not four. *Awaiting the owner's stamp; not enacted.*

**(b) FIX-1355's scope line needs revision.** FIX-1355 reads *"lab that exercises rooms / L2
channels / resources / skills conventions + seats."* If (a) is stamped, the third item has no
referent and the clause drops (FIX-1353 §8 step 3). *Awaiting the owner's stamp; not enacted.*

**One gap the fold exposes that no stamp closes on its own:** the lab needs a static intake DM
before Collab opens, and **no issue owns it** — FIX-1311 owns the group board, FIX-1341 the
post-lab roster, and FIX-1353 searched and found nothing covering it. §5 carries it, and FIX-1353
makes it an **exit condition**: that issue does not close while the pre-lab DM is unowned.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| FIX-1342 | Kinds-map fence — seats stay `WORKER.md`; custom kinds are flow factories | spec | [#1702](https://github.com/fixpoint-labs/flow-state-dev/pull/1702) *(closed at approval)* | [#1712](https://github.com/fixpoint-labs/flow-state-dev/pull/1712) *(draft)* | Spec Approved |
| FIX-1352 | Rooms file convention (either-source; declaration-only) | spec | [#1711](https://github.com/fixpoint-labs/flow-state-dev/pull/1711) | — | In Spec Review |
| FIX-1353 | L2 channels fold — no `CHANNEL.md`, zero production code | spec | [#1714](https://github.com/fixpoint-labs/flow-state-dev/pull/1714) | — | In Spec Review |
| FIX-1354 | Resources file convention | spec | [#1715](https://github.com/fixpoint-labs/flow-state-dev/pull/1715) | — | In Spec Review |
| FIX-1355 | Thin pentest lab Proof | spec | — | — | Backlog |
| FIX-1356 | Skills file convention | spec | [#1716](https://github.com/fixpoint-labs/flow-state-dev/pull/1716) | — | In Spec Review |
| FIX-1357 | Kinds + blocks boot scan (file-convention registration) | spec | — | — | Backlog |
| FIX-1358 | Atlas: one convention for rooms/L2 channels (fold from FIX-1353) | *unset* | — | — | Backlog |

*Every row carries the `Feature` label except FIX-1358, which is unlabelled — so its route is not
set, and its blank Spec PR cell records an unanswered question rather than a `direct` route.
Whoever labels it settles that.*

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

- **Nobody owns the pre-lab static intake DM the lab needs.** Raised by FIX-1353 §8 step 4, which
  searched and found no covering issue. FIX-1311 owns the group board; FIX-1341 owns the post-lab
  roster; neither covers a static intake DM, and the lab needs one before Collab opens. The
  session route ships and only the helper is unwritten — the atlas's `openDm` is a proposal, not
  an issue. **The choice is to file it under the epic or fold it into FIX-1355's scope.
  Decides:** the owner. **Blocks:** FIX-1353 cannot close while it is unowned.

- **Every W3 convention is built before its only consumer.** Raised by FIX-1353 §12; FIX-1352's
  Decision 1 names the same thing for rooms in particular (*"rooms is also the least useful of the
  four to ship alone"*). The lab (FIX-1355) is sequenced last and is the first thing that would
  declare a room, resource, or skill in files. FIX-1353 notes this is the epic's ordering rather
  than any one issue's problem, and that it is cheaper to change now that one convention has
  dissolved. **Decides:** the owner — it is a sequencing call on the floor. **Blocks:** nothing
  today.

- **Collection-vs-N-singles row compatibility at the resources ref form is unclaimed.** Raised by
  FIX-1354 §12. The atlas's worked shape for team documents is
  `defineResourceCollection({ pattern: "teams/[teamId]/[doc]", scope: "org" })` — one
  parameterised collection, not N singles. FIX-1354 installs singles **at that same ref form**, so
  the keys do not diverge, but the install shapes differ and **row-compatibility between them is
  explicitly unverified**. Whoever moves documents onto a collection settles it first; no issue
  owns that today. **Decides:** unassigned — it needs an owner. **Blocks:** nothing in W3.

- **The four conventions will not be symmetrical, and the epic should say so once.** Raised by
  FIX-1356. Rooms, channels and resources are new and share a shape; skills are older, external,
  and do not — FIX-1352 already anticipated it (*"it is evidence the convention shape is real. It
  is not shared code"*). Recording the intended end state is what stops the next reader filing it
  as drift. FIX-1354 adds a second asymmetry the same sentence has to cover: three conventions are
  folder-per-thing, resources is file-per-thing. **Decides:** the epic's docs pass owes the
  sentence; nobody has written it. **Blocks:** nothing.

- **The consumer reshape.** Raised by FIX-1353 §3 as the strongest alternative use of its own
  slot: give the rooms convention its missing consumer — one helper that opens a session for a
  declared room. Buildable on today's APIs, but it crosses the epic's Collab fence, which the
  Architect has cleared twice. Raised rather than absorbed. **Decides:** the owner. **Blocks:**
  nothing.

- **~~Rooms and L2 channels may be one convention.~~** *Resolved:* they are one. Raised by
  FIX-1352 §12 commenting up, and again on this epic's issue on 2026-09-11; answered by FIX-1353's
  Decision 1, with the Architect's answer posted on #1711. **Its two floor recordings are still
  pending the owner's stamp** — §3(a) and §3(b).

---

## Epic evolution

- **Epic-spec stood up (late)** — four sub-specs had already converged with no epic document and
  no `epic/*` branch. Transcribed from FIX-1351, #1703 and the four spec PRs; nothing composed.
  The inherited shape rules got a canonical home (theme 1), the rule-4/7 correction was folded
  verbatim (theme 2), and the channels fold plus FIX-1355's scope line were recorded as pending
  the owner's stamp rather than applied.
