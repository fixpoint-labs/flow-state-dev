# FIX-1351 — W3: File-convention surface (channels/resources/skills) + thin pentest lab Proof

*Everything here is transcribed from the record — [FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351) /
[#1703](https://github.com/fixpoint-labs/flow-state-dev/issues/1703), its comments, the sub-spec
PRs, and the owner's four stamps of 2026-09-11 on this PR — the 17:32 rewrite, the 17:34 cut, the
22:28 ChannelFlow lock and the 22:29 D-4 cut that narrows it. Where the record does not settle
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

**Three things in that quote were superseded by the owner on 2026-09-11**, and the quote is left
as agreed rather than edited. From the
[17:32 rewrite](https://github.com/fixpoint-labs/flow-state-dev/pull/1718#issuecomment-5638262951):
the product noun is **channel**, not room, and the first bullet's "rooms" and "L2 channels" are
**one** convention rather than two. From the
[22:28 lock](https://github.com/fixpoint-labs/flow-state-dev/pull/1718#issuecomment-5641352275):
that bullet's parenthetical "**sessions/boards**" is now half right — a channel *is* a session,
and **board is retired as an author-facing noun** (below). Every later occurrence of "room" or
"board" in this document is either inside a quotation or names a thing that predates the
supersession. §3 carries the floor as it now stands.

**The problem it answers**, quoted from the same description: *"W2 landed the worker loader +
seat factory spine. Apps still lack a file-convention surface for the rest of a Workforce —
rooms, L2 channels (as sessions/boards), resources, and skills — and have no thin lab Proof that
the conventions hold under real multi-seat pressure."*

**Invent kill**, as the owner restated it on 2026-09-11: no **`MessageBoard` L1 package type**
(a Flow/Session peer); no **`Channel` L1 substrate type**; no TeamFlow L1; no framework
runtime-import of seat `worker.ts` as a WorkerManifest path.

**Message Board also retires as the author-facing noun** — the
[lock of 2026-09-11 22:28](https://github.com/fixpoint-labs/flow-state-dev/pull/1718#issuecomment-5641352275).
The **package-type** kill above is unchanged and strengthened by it. What additionally goes is
*board* as a word an author says: a channel is a **replaceable L2 flow kind**, shipped as a
default batteries-included **ChannelFlow** in Workforce, and one channel is one flow **instance**
with a coherent transcript. A post is a **dispatch into that channel's session** — background,
with a durable log on the channel — not `reactTo` on the poster's turn.

**What survives the retirement is the mechanism, not the noun.** Smart resource + `reactTo`
remains valid for *non-conversation* shared state, activity and topic logs, and framework
teaching; [#1627](https://github.com/fixpoint-labs/flow-state-dev/pull/1627) is the
characterization of **that** path and not the Workforce channel API. A topic or activity log is
**not** a channel — a different kind later if one is wanted. `ChannelFlow` is L2 opinion at the
same altitude as the agent kind, which is how the concept ships while the L1 kill holds.

**Holistic necessity.** Nine live issues, seven on the floor (§3); FIX-1357 (boot scan) and
FIX-1358 (atlas) are in the epic but off it. **The overbuild risk is sequencing-shaped:** all
three file conventions — channels (FIX-1352), resources (FIX-1354), skills (FIX-1356) — ship
before any consumer exists, with the lab (FIX-1355) last, so a lab that finds one convention
wrong reworks three specs at once. **The set survives that anyway.** The three share one
walk-primitive set (theme 1's rules, theme 4's answer) and channels feeds the other two, so
building one, proving it, then standing the shared setup up twice costs more than the rework it
avoids.

**The 2026-09-11 recut narrows that question for channels without closing it.** Item 0 is no
longer a composition an author assembles; it ships a **default ChannelFlow kind**, and the
channels convention declares *instances* of it (`flow:`, exactly as `WORKER.md` sets it). So
FIX-1352 no longer declares into a void — the `flow:` it names resolves to something landing in
the same epic, and a wrong declaration shape now fails against a real kind. That is a
**dependency**, not yet a consumer: nothing on the floor *reads* a `CHANNEL.md` and opens the
session it declares, and the opener is still on the Collab side of the fence (§5, the consumer
reshape). Resources and skills gain nothing from the recut.

**Item 4 answers the skills half** — FIX-1367 gives skills a real non-lab caller ahead of the
lab, which is the restraint move this check would recommend, reached by another route.
**Kept, with that pattern made the rule:** each convention earns a non-lab consumer before the
lab lands, or that is the signal it was built too early. Channels is now the closest to meeting
it and resources is furthest from it. The sequencing call itself is the owner's and stays open
in §5.

**FIX-1358 is no longer the weakest member.** It was, while it documented a rename. The recut
makes it the atlas teach for a **new kind floor**, and the lock names Atlas obligations among
what this recut folds — a larger and more load-bearing job than a vocabulary sweep. It stays off
the floor because no owner comment placed it there, not because it is thin (§5).

**Not doing** — the held list, recorded rather than re-argued: MCP
([FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333)) until the lab, and not this epic's
door; **Collab RC / [FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341), which the D-4 cut
names by hand — the roster does not come into the W3 floor**, and its channels lock feeds W3's
channels convention rather than full Collab; dynamic addresses; cross-flow; and the old board-PRD
items that did **not** join ChannelFlow's admission — brief, housekeeper, retirement, CAS —
blocking nothing (§3, "Out of admission"; §5 carries the one of the four the record does not
place). W3 does **not** nest under
[FIX-1332](https://linear.app/fixpoint-labs/issue/FIX-1332) (W2 — prior, not parent).

## 2. Themes & long-horizon direction

### Theme 1 — The inherited shape rules. This is their canonical home.

Seven rules govern all three conventions, and **they live here now.** FIX-1352's spec dropped its
original seven-point block for a pointer to the canonical sources — the shipped `WORKER.md` pair
(`packages/workforce/src/loader/read-workforce-directory.ts` and `hire.ts`) plus the atlas §06
tree — so no copy would go stale when the originals move. That left the numbered form alive only
inside [FIX-1354 §7's inheritance table](https://github.com/fixpoint-labs/flow-state-dev/pull/1715),
a table inside one of the specs the rules govern. A convention deviates from one only with a
stated reason in its own spec.

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
[FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351#comment-ec11496a) on 2026-09-11 and
verified against source. Reproduced unaltered — **including its "rooms", which predates the same
day's rename and means today's *channel*.** Renaming inside a verified quotation would cost more
than the inconsistency does.

**Read the rule for its outcome, not its verb.** The invariant is that *a key declared in
frontmatter can never become a field the convention derives*; refusal is the last of the three
ways to reach it. The bolded line below names that third mechanism, not the whole rule —
mechanism 1 reaches the same outcome by shape, with nothing left to refuse.

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

**Rewritten twice on 2026-09-11.** First to the owner's cut — the
[owner rewrite](https://github.com/fixpoint-labs/flow-state-dev/pull/1718#issuecomment-5638262951)
at 17:32 and the [Cycle PM cut](https://github.com/fixpoint-labs/flow-state-dev/pull/1718#issuecomment-5638301871)
at 17:34 that narrows it. Then again that evening, to the
[ChannelFlow lock](https://github.com/fixpoint-labs/flow-state-dev/pull/1718#issuecomment-5641352275)
at 22:28 and the [D-4 cut](https://github.com/fixpoint-labs/flow-state-dev/pull/1718#issuecomment-5641360157)
at 22:29 that narrows *it* — which replaced the product noun under item 0 rather than resizing
it. Each is quoted below wherever it decides something, and superseded quotations are kept as
recorded rather than edited. The originally agreed floor is kept at the end of this section: two
of its six items no longer exist in that form.

### The floor as it now stands

| # | Item | Issue | Note |
|---|---|---|---|
| 0 | **Default ChannelFlow — the channel kind floor** | [FIX-1311](https://linear.app/fixpoint-labs/issue/FIX-1311) / [#1565](https://github.com/fixpoint-labs/flow-state-dev/issues/1565) | **First, and the only blocking item.** Ship the default batteries-included **ChannelFlow** as a replaceable **L2 flow kind** — subscribe, post (a dispatch into the channel session, background, durable log), fan-out policy, and **clean transcript projection from day one**. The conversation door only. The minimal notify door becomes the internal / teaching path underneath it, not the public API. No `MessageBoard` / `Channel` L1 package type |
| 1 | **Channels file convention** | [FIX-1352](https://linear.app/fixpoint-labs/issue/FIX-1352) | One L2 file type. Absorbs what were floor items 1 and 2. **Declares ChannelFlow instances** — a `CHANNEL.md` may set `flow:` exactly as `WORKER.md` does — not board bindings |
| 2 | Resources file convention | [FIX-1354](https://linear.app/fixpoint-labs/issue/FIX-1354) | Unchanged |
| 3 | Skills file convention | [FIX-1356](https://linear.app/fixpoint-labs/issue/FIX-1356) | Unchanged |
| 4 | **Thin `WorkerConfig` admission** | [FIX-1367](https://linear.app/fixpoint-labs/issue/FIX-1367) | **Added 2026-09-11.** Hire invokes the flow with the right config: the `skills` bag from item 3's register, plus an always-present extension placeholder for kind-owned schema. Soft-blocked on that register; blocks nothing |
| 5 | Thin pentest lab Proof | [FIX-1355](https://linear.app/fixpoint-labs/issue/FIX-1355) | Last. The first consumer that **declares** a channel, resource or skill in files — item 4 consumes the skills register earlier, by reading records |
| 6 | Kinds-map fence — not `worker.ts` hire | [FIX-1342](https://linear.app/fixpoint-labs/issue/FIX-1342) | Unchanged |

**In the epic, off the floor:** [FIX-1357](https://linear.app/fixpoint-labs/issue/FIX-1357) (kinds
+ blocks boot scan) and [FIX-1358](https://linear.app/fixpoint-labs/issue/FIX-1358) (atlas
reconciliation). Neither owner comment placed them, so they are members of the set without being
part of the required seven — which is why the explainer draws them on a dotted edge.

**Item 0 is a kind, not a board.** The 17:34 cut that first sized this item is quoted as
recorded, and is **superseded by the 22:28 lock** — which changed the noun under it, not the size:

> W3 floor pre-req is the **minimal notify door** of FIX-1311 / #1565 (collection + subscriptions
> + `reactTo` + declared dispatchers — #1627 shape), **not** the full board PRD.

What that quotation still gets right is the **size**: the floor is the smallest thing that opens
a channel, not a product. What it no longer gets right is the **shape**. There is no Board PRD to
be a fraction of; the notify door is an internal or teaching path; and the public model is a post
dispatched into the channel's own flow session.
[#1627](https://github.com/fixpoint-labs/flow-state-dev/pull/1627) — the throwaway lab that ran
that path on today's doors and closed — stays the characterization of the **smart-resource
notify** path and is explicitly not the Workforce channel API.

**The blocking edge to item 1 survives, and changes character.** It was door-before-binding: the
convention needed a mechanism to bind to. It is now **kind-before-instance** — a `CHANNEL.md`
setting `flow:` declares an instance of a kind, and the default ChannelFlow is what an undeclared
one resolves to. The owner's sequencing stamp (FIX-1311 first, blocking the channel children) is
untouched by the recut.

**Out of admission — blocking nothing.** The D-4 cut landed a minute after the lock and is
narrower than the lock's own phrasing; it governs:

> ChannelFlow default kind is the conversation door only. Do **not** pull Collab roster /
> FIX-1341 into the W3 floor. Brief / housekeeper / CAS from the old board PRD stay **out** of
> ChannelFlow *admission* — only minimal **clean transcript projection** in the default kind (not
> a second board product).

The two stamps name overlapping but different subsets of the original four phased items, so they
are read together rather than either alone:

| Item | In ChannelFlow admission? | A ChannelFlow behavior later? |
|---|---|---|
| Brief | **No** — named out, 22:29 | Yes — 22:28 |
| Housekeeper | **No** — named out, 22:29 | Yes — 22:28 |
| Retirement | **No** — phased behind since 17:34, and nothing since moved it in | Yes — 22:28 |
| CAS | **No** — named out, 22:29 | **Neither stamp says** — §5 carries it |

None of the four blocks anything, which no stamp has changed. The one thing the record does not
settle is where **CAS** belongs now that there is no Board PRD to hold it: the 22:28 stamp lists
the ChannelFlow behaviors and omits it, while the same stamp keeps smart resource + `reactTo`
alive for exactly the sort of non-conversation shared state a compare-and-swap guards. It is not
placed here.

**Only item 0 carries a blocking edge**, and it carries it to item 1. Treating the whole of
FIX-1311 as the gate would hold three issues the cut exists to free — the single most expensive
way to read this section wrong.

**Still held — recorded, not scheduled.** Dynamic addresses; cross-flow; **Collab RC /
[FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341), which the D-4 cut names in its own
sentence**; MCP ([FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333)) until the lab. The
recut grows item 0 from a composition into a shipped kind, which is the direction a roster would
be pulled in from — and the cut closes that door in the same breath it opens this one.

### Item 4 — what makes "a seat works" honest

**Added by the owner and the Architect on 2026-09-11**
([comment](https://github.com/fixpoint-labs/flow-state-dev/pull/1718#issuecomment-5639946995)).
Quoted, because the honesty claim is the part that decides something:

> Epic honesty for "a seat works" includes hire invoking the flow with correct config (`skills`
> bag from FIX-1356 + extension placeholder for kind-owned schema). **Non-agent Proof on 1367 is
> the contract gate.**

Until this item lands, a seat can be minted and still be handed nothing it declared. So the
epic's "a seat works" claim rests on hire calling the flow with a config the kind actually
admits — the `skills` bag sourced from item 3's seat register, and one always-present extension
placeholder that kind-owned schema validates.

**The gate is one sentence, and it turns on the door rather than the payload.** The non-agent
Proof on [FIX-1367](https://linear.app/fixpoint-labs/issue/FIX-1367) — a hireable kind that is
not an agent *accepts* `skills` and may ignore them — is the contract gate. **Empty or unused is
fine; the absent door is not.** An agent E2E does not stand in for it.

**The W2 path proof is a different proof, and stays where it is.** Folder → records → mint
(Option 1 on [FIX-1325](https://linear.app/fixpoint-labs/issue/FIX-1325) /
[FIX-1335](https://linear.app/fixpoint-labs/issue/FIX-1335)) belongs to W2 and lives on
[#1664](https://github.com/fixpoint-labs/flow-state-dev/pull/1664). This epic does not conflate
the two, and no W2 spine spec is reopened for this contract: W2 proves a seat is *minted*, W3
proves it is *configured*.

**The contract floor itself lives on FIX-1367, not here.** Its thin fields, its delivery path
into the instance config bag, and its own invent-kill clause — no mandatory `model` / `memory` /
`tools` / `activate` on the thin door, those staying with the agent kind
([FIX-1359](https://linear.app/fixpoint-labs/issue/FIX-1359), a parallel epic this item does
not wait on) — are the issue's to state and enforce. Named here, not reproduced; a copy rots.

### Channel replaces room

Quoted from the owner rewrite:

> * Product word = **channel** (DM + group approachability).
> * One L2 file type (prefer `CHANNEL.md`); fold the old "rooms" + "L2 channels" dual into **one**.
> * "Room" is at most a channel *kind* / flavor later — not a parallel noun on the epic floor.

This settles the fold the previous revision carried as *pending the owner's stamp*, **in a
different shape than that edit proposed.** The proposal was arithmetic — delete floor item 2, four
conventions become three. The answer is a noun: **channel absorbs room**, one word and one file
type, **and** FIX-1311 joins the floor ahead of everything. W3 does finish as three file
conventions plus the lab, but that count is a consequence of the rename, not the decision.

**The evening lock went one noun further**, in the other direction: *board* also stops being a
word an author says (§1). The morning rewrite settled what a channel is **called**; the lock
settled what a channel **is** — an instance of an L2 flow kind.

**`CHANNEL.md` is preferred, not fixed.** "Prefer" is the owner's word; FIX-1352 owns the
filename. Everything else in this subsection is settled.

### The floor as originally agreed — superseded, kept for reference

> 1. Rooms file convention (system + dynamic; either-source — [FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) lock)
> 2. L2 channels as sessions/boards
> 3. Resources file convention
> 4. Skills file convention
> 5. Thin pentest lab Proof
> 6. [FIX-1342](https://linear.app/fixpoint-labs/issue/FIX-1342) — kinds-map fence (not worker.ts hire)

Its items 1 and 2 are now the one channels convention. Item 0 is new, and was itself recut the
same evening — from a board composition to the default ChannelFlow kind.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| FIX-1311 | **Default ChannelFlow / channel kind floor**: subscribe, post by dispatch, fan-out policy, clean transcript projection | spec | — | — | Backlog — **first on the floor, and not started** |
| FIX-1342 | Kinds-map fence — seats stay `WORKER.md`; custom kinds are flow factories | spec | [#1702](https://github.com/fixpoint-labs/flow-state-dev/pull/1702) *(closed at approval)* | [#1712](https://github.com/fixpoint-labs/flow-state-dev/pull/1712) *(draft)* | In Review |
| FIX-1352 | Declare ChannelFlow instances (either-source; declaration-only) | spec | [#1711](https://github.com/fixpoint-labs/flow-state-dev/pull/1711) | — | In Spec Review |
| FIX-1353 | *L2 channels fold* — **closed as a duplicate** of the channels convention | — | [#1714](https://github.com/fixpoint-labs/flow-state-dev/pull/1714) | — | Duplicate |
| FIX-1354 | Resources file convention | spec | [#1715](https://github.com/fixpoint-labs/flow-state-dev/pull/1715) | — | In Spec Review |
| FIX-1355 | Thin pentest lab Proof | spec | — | — | Backlog |
| FIX-1356 | Skills file convention | spec | [#1716](https://github.com/fixpoint-labs/flow-state-dev/pull/1716) *(closed at approval)* | [#1728](https://github.com/fixpoint-labs/flow-state-dev/pull/1728) *(draft)* | In Review |
| FIX-1357 | Kinds + blocks boot scan (file-convention registration) | spec | — | — | Backlog |
| FIX-1358 | Atlas: ChannelFlow teach (kind floor + declaration) | *unset* | — | — | Backlog |
| FIX-1367 | Thin `WorkerConfig` admission — hire fills `skills` from FIX-1356's seat register; extension placeholder for kind-owned schema | spec | — | — | Todo — soft-blocked on FIX-1356's register ([#1728](https://github.com/fixpoint-labs/flow-state-dev/pull/1728)) |

Six things this table does not say on its own:

- **FIX-1311 carries the `Feature` label**, so its route is `spec` and its spec is unwritten. The
  critical-path item is the one with the least done to it.
- **FIX-1352's titles have both moved on; its spec PR body has not.** The room→channel rename
  landed in [#1711](https://github.com/fixpoint-labs/flow-state-dev/pull/1711)'s title, and Linear
  has since moved further, to *Declare ChannelFlow instances*. The PR **body** still describes its
  new dependency as *"the message board's minimal notify door"* and still says *"the board itself
  ships as named L1 composition on FIX-1311"* — the superseded model. That is FIX-1352's fold to
  make, not this document's.
- **FIX-1353 closes as a duplicate, but its one unowned item does not close with it.** The pre-lab
  intake DM is rehomed onto FIX-1311 and carried in §5 — a reshuffle is exactly how such a thing
  disappears.
- **FIX-1357 and FIX-1358 are in the epic but off the floor** (§3) — members of the set, not
  part of the required seven. FIX-1358 is also unlabelled, so its route is unset and its blank
  Spec PR cell records an unanswered question rather than a `direct` route; whoever labels it
  settles that.
- **FIX-1367's dependency is on the register's *read* side**, which is what #1728 ships.
  Registration — wiring those skills onto a live seat — is an explicit non-goal there and is what
  item 4 exists to do: a merged #1728 does not make the bag reach a kind.
- **Linear nesting and `blockedBy` belong to the Linear Manager**, per the owner's own comment.
  Nesting is done: all ten are parented under FIX-1351 (verified 2026-09-11). **The blocking edge
  is not in Linear at all** — FIX-1311's links to FIX-1352, FIX-1353 and FIX-1358 are every one of
  them `related`, and the graph carries no `blocks` relation. So the floor's one blocking edge
  (§3, item 0 → item 1) lives in this document and the owner's comments and nowhere in the
  tracker. Recorded for the Linear Manager; not changed from here.

## 5. Open cross-cutting questions

Raised by the sub-specs commenting up, or by the record itself. None of them blocks the objective
gate.

- **~~Skill names are globally unique across an app's teams — is that good enough for the lab
  Proof?~~** *Closed 2026-09-11 — the premise was withdrawn.* Raised by FIX-1356 on its 02:42
  framing, that two teams cannot each have a skill called `review`. The **D-4 lock** that evening
  supersedes it: *"Spec #1716 was approved for the register/isolation shape — this lock does
  **not** reopen Dec 2–3 **withdrawn global-unique**."* FIX-1356 isolates by narrowing what a
  seat **reads** — `readSeatSkills` over org ∪ team ∪ worker-local — and the shipped refusal is
  keyed on the **worker**, a name reaching one seat twice, not on the app. Two teams can each
  have a `review` skill. There is no namespace question left for the lab Proof, and nothing
  outstanding at FIX-1356's gate, which passed on that shape.

- **Where does CAS live, now that there is no Board PRD to hold it?** Raised by the two stamps
  of 2026-09-11 naming different subsets of the four phased board-PRD items (§3's table). Brief,
  housekeeper and retirement are each placed by one stamp or the other: out of ChannelFlow
  admission, and ChannelFlow behaviors later. **CAS is named only on the exclusion side.** No
  stamp says whether it becomes a ChannelFlow behavior in a later phase, or belongs to the
  smart-resource + `reactTo` path the same lock keeps alive for non-conversation shared state —
  which is what a compare-and-swap usually guards. Placing it on either side from here would be
  inventing scope. **Decides:** the owner, with the Architect — it is their own two stamps that
  diverge. **Blocks:** nothing; it is out of admission on both readings.

- **The pre-lab static intake DM now has a home, and the recut moved what is left open.** Raised
  by FIX-1353 §8 step 4, which found no covering issue at all; with FIX-1353 closing as a
  duplicate it is **rehomed onto FIX-1311**. The old fork — notify door or phased-behind half —
  is largely answered: under the lock a DM is a one-participant **channel instance**, so
  declaring one is a `CHANNEL.md` (item 1) and posting into one is the default kind's own verb
  (item 0). Both are in admission. **What is still open is the opener**: the helper that opens and
  names one durable DM session before any roster exists is still unwritten, and it is the same
  helper the consumer-reshape question below keeps on the Collab side of the fence. The session
  route ships; the atlas's `openDm` is a proposal, not an issue. **Decides:** the owner, with the
  Architect. **Blocks:** nothing today; FIX-1355 if the opener is still unplaced when the lab
  starts.

- **Every W3 convention is still built before its only consumer.** Raised by FIX-1353 §12;
  FIX-1352's Decision 1 says the same of channels (*"rooms is also the least useful of the four to
  ship alone"*). **§1's necessity check owns this and keeps the set** — the three conventions
  share one walk-primitive set, so building them one at a time costs more than the rework it
  avoids — with the tripwire that each earns a non-lab consumer before the lab lands. What is
  still open is the sequencing call itself, which is the owner's. **The evening recut narrows it
  for channels and is easy to misread as having closed it:** the default ChannelFlow kind gives a
  `CHANNEL.md` something real to be an instance *of*, which is a dependency — it is still not a
  consumer that reads a declaration and opens what it names. **Item 4 narrows the skills half** —
  FIX-1367's non-agent Proof consumes the skills register through hire, so skills gains a caller
  ahead of the lab, though it reads records rather than declaring a skill in a file. **Resources
  gains nothing from either**, which makes it the convention most exposed to the tripwire.
  **Blocks:** nothing today.

- **Collection-vs-N-singles row compatibility at the resources ref form is unclaimed.** Raised by
  FIX-1354 §12. The atlas's worked shape for team documents is one parameterised collection —
  `defineResourceCollection({ pattern: "teams/[teamId]/[doc]", scope: "org" })` — not N singles.
  FIX-1354 installs singles **at that same ref form**, so the keys do not diverge, but the install
  shapes differ and **row compatibility is explicitly unverified**. Whoever moves documents onto a
  collection settles it first. **Decides:** unassigned — it needs an owner. **Blocks:** nothing in
  W3.

- **The three conventions will not be symmetrical, and the epic should say so once.** Raised by
  FIX-1356. Channels and resources are new and share a shape; skills are older, external, and do
  not — FIX-1352 anticipated it (*"it is evidence the convention shape is real. It is not shared
  code"*). Recording the intended end state is what stops the next reader filing it as drift.
  FIX-1354 adds a second asymmetry the sentence has to cover: folder-per-thing for two
  conventions, file-per-thing for resources. **A second line the same pass owes:** the atlas describes
  `teams/<id>/resources/` with an explicit *"org + team key"* but `teams/<id>/skills/` with only
  *"same `SKILL.md` wiring, this team"*. Isolation-by-narrowing makes "this team" true, so the
  contradiction the withdrawn question named is gone; two phrasings describing different kinds of
  thing remain. Overlaps an atlas ambiguity already escalated to the owner; not settled here.
  **Decides:** the epic's docs pass owes both sentences. **Blocks:** nothing.

- **The atlas owes a ChannelFlow rewrite, and this document cannot make it.** The lock ends with
  *"Fold epic § / floor list / Atlas obligations."* The first two are folded here; the third is a
  change to `docs/atlas/workforce.html`, which is FIX-1358's surface and outside this epic-spec.
  What the atlas now owes, named so it is not lost: **(a)** a channel taught as a replaceable L2
  flow kind with a default ChannelFlow, not as a board an author binds; **(b)** `CHANNEL.md` with
  `flow:`, on the `WORKER.md` precedent; **(c)** *Message Board* removed as an author-facing noun,
  with smart resource + `reactTo` kept and **relabelled** as non-conversation shared state and
  teaching rather than deleted; **(d)** §16's `openDm` re-read against post-as-dispatch — it is
  still a proposal, but it now proposes into a different model; **(e)** nothing taught about a
  task board assigning a channel as worker, which the lock parks with four named walls. This sits
  **on top of** the atlas ambiguity already escalated to the owner in the bullet above; neither
  is settled here. **Decides:** the owner, via FIX-1358 — which is also why that issue is no
  longer the epic's weakest member (§1). **Blocks:** nothing in W3.

- **The consumer reshape.** Raised by FIX-1353 §3 as the strongest alternative use of its own
  slot: give the channels convention its missing consumer — one helper that opens a session for a
  declared channel. The recut sharpens it rather than settling it. A channel is now *defined* as a
  flow instance, so "open a session for a declared channel" is no longer an extra concept bolted
  on; it is the one verb the floor stops short of. It is also still on the Collab side of the
  fence the Architect has cleared twice, and the D-4 cut re-drew that fence the same evening.
  **Decides:** the owner. **Blocks:** nothing.

- **~~Rooms and L2 channels may be one convention.~~** *Closed 2026-09-11.* They are one, and the
  one is called a **channel**. Raised by FIX-1352 §12 commenting up; answered by FIX-1353's
  Decision 1; settled by the owner's rewrite on this PR, which chose the noun as well as the
  count. Applied to the floor in §3 — no stamp is outstanding.

---

## Epic evolution

- **Epic-spec stood up (late)** — four sub-specs had already converged with no epic document.
  Transcribed from FIX-1351, #1703 and the spec PRs; nothing composed. The inherited shape rules
  got a canonical home (theme 1) and the rule-4/7 correction was folded verbatim (theme 2).
- **Floor rewritten to the owner's 2026-09-11 17:32/17:34 cut** *(item 0 recut again that
  evening — see the last two entries)* — FIX-1311's **minimal notify door** joins
  first and is the only blocking item, the rest of its board PRD phased behind it; **channel
  replaces room**, folding the rooms/L2-channels dual into one file type; the invent-kill slogan
  corrected to no MessageBoard **L1 package type**, the `Channel` L1 substrate kill unchanged. The
  section was rewritten rather than ticked off, because it was answered in a different shape than
  it was asked.
- **FIX-1367 joins the floor as item 4** — thin `WorkerConfig` admission, because "a seat works"
  is not honest until hire invokes the flow with a config the kind admits; its **non-agent Proof
  is the contract gate**. The W2 path proof (folder → records → mint) is a different proof and
  stays on #1664.
- **Necessity check written into §1** — the set is kept, with the rule that each convention earns
  a non-lab consumer before the lab lands; §5's consumer question points at it rather than
  floating unowned, and the floor now names FIX-1357 and FIX-1358 as off it, because the floor and
  the explainer had implied different required sets.
- **Global skill-name uniqueness closed as withdrawn** — FIX-1356's D-4 lock supersedes the 02:42
  framing §5 transcribed: the approved shape is register/isolation and the refusal is per-seat, so
  two teams can each have a `review` skill.
- **Item 0 recut from a board to a kind (owner lock, 2026-09-11 22:28)** — **Message Board retires
  as the author-facing / L1 concept.** A channel is a replaceable **L2 flow kind** with a default
  batteries-included **ChannelFlow**; one channel is one flow instance with a coherent transcript;
  a post is a dispatch into that session, not `reactTo` on the poster's turn; clean transcript
  projection ships in the default kind from day one. The **package-type** invent-kill is unchanged
  and strengthened. Smart resource + `reactTo` survives for non-conversation shared state,
  activity logs and teaching — #1627 is the characterization of that path, not the channel API.
  The minimal notify door becomes an internal / teaching path beneath the public one. Task board
  assigning a channel as worker is parked with four named walls. §1, §3 and §4 were rewritten
  rather than annotated; the 17:34 scope quotation is kept and marked superseded.
- **And narrowed one minute later (D-4 cut, 2026-09-11 22:29)** — the default kind is the
  **conversation door only**: brief, housekeeper and CAS stay **out of ChannelFlow admission**,
  with only minimal clean transcript projection inside it, and the **Collab roster / FIX-1341 does
  not come into the W3 floor**. This narrows the lock rather than restating it, and it is why §3
  reads the two stamps together in a table instead of quoting either alone. The four old
  phased items land on the exclusion side; **CAS's later home is the one thing neither stamp
  settles, and §5 carries it as an open question rather than placing it.**
