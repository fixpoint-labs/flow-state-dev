# FIX-1388 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
(BR-n) and [DECISIONS.md](DECISIONS.md) (D-n). `tdd`. Three PRs; the seams are between Discover,
Install and Select.

## Surfaces

| ID | Package · role | Change | Rules |
|---|---|---|---|
| S1 | `workforce` · the code-convention walk | A fourth family beside the three locked code folders: **all three** scoped `resources/` roots — the organisation's, a team's and a worker's own (D3) — TypeScript entries only, refs minted the way the document walk mints them. A separate adapter over the shared walk primitives, consuming what FIX-1389 published rather than growing a parallel walk. It mirrors the resources reader's slot topology rather than joining the flat `flows/`-and-`blocks/` slot list, and it **shares the document reader's ref-minting helper** (private today) instead of writing a second ref story | BR-1 BR-2 BR-3 BR-5 BR-20 BR-21 |
| S2 | `workforce` · the code-convention render | A fourth exported map on the generated module, keyed by ref, typed so a module exporting the wrong shape fails the app's own typecheck rather than the walk | BR-9 |
| S3 | `workforce` · the one place both doors' refs are known | Refuse a basename claimed by both a document and a module. The convergence point for ref uniqueness — where both lists exist, not in either walk. A set intersection over refs both sides have **already produced**, never a second tree walk | BR-4 BR-10 |
| S4 | `cli` · the generate command | Count and print the new family in the summary; `--check` covers it with no special case | BR-6 |
| S5 | `workforce` · the install half, beside the one that turns documents into resources | Split a module's exports into the capabilities an app hands to the kind's `uses` and the resources it merges into the one map. Pure and isomorphic, like its sibling | BR-7 BR-8 |
| S6 | `workforce` · the built-in worker kind's seat settings | One authored key naming capabilities and the presets a seat wants, validated **at the mint** the way `tools:` already is — a refinement on the settings schema, not the turn-time path `skills.active` takes | BR-13 BR-14 |
| S7 | `workforce` · the built-in kind's capability slot | The seat's selection, resolved through **exactly one path per capability per seat** — see the pinned constraint below. A capability must not contribute its presets statically *and* dynamically, and its resources must still reach the flow | BR-11 BR-12 BR-15 BR-22 |
| S8 | `workforce` · the document reader's skip branch | **Rewrite the comment**, not the branch: it claims a non-`.md` entry carries no sign anyone meant it, which stops being true here. The module header repeats the claim | — |
| S9 | `apps/kitchen-sink` · the workforce tree | One discovered capability and two seats that name different selections — the fixture the goal check grades on | BR-11 BR-15 |
| S10 | Docs | New page and two README entries; one `minor` changeset covering `workforce` and `cli` | — |

Nothing is removed. The one thing that looks removable — the silent skip in the document reader —
stays: Door A keeps passing over what is not its file.

## Sequence

```mermaid
flowchart TD
  S1["S1 · the module walk"] --> S2["S2 · the fourth map"]
  S2 --> S3["S3 · one ref, one owner"]
  S3 --> S4["S4 · the command's summary"]
  S4 --> S5["S5 · modules become uses + one map"]
  S5 --> S8["S8 · correct the skip comment"]
  S5 --> S6["S6 · the seat's key"]
  S6 --> S7["S7 · per-seat presets"]
  S7 --> S9["S9 · the reference tree"]
  S9 --> S10["S10 · docs"]
```

### PR plan

| PR | Deliverables | depends_on |
|---|---|---|
| P1 · Discover | S1 S2 S3 S4 | — |
| P2 · Install | S5 S8 | P1 |
| P3 · Select | S6 S7 S9 S10 | P2 |

P1 ships a command that finds the files and a map nothing reads yet — deliberate, and reviewable on
its own. P2 makes the map usable. P3 is the seat's half, and the only one touching the built-in kind.

## Checks

| ID | Runs after | Passes when |
|---|---|---|
| V1 | S1 | BR-1, BR-2, BR-3, BR-5, BR-20, BR-21 over a fixture tree covering all three roots. BR-21's refusal is planted and seen red before it is trusted. Refusals collect — one run names every bad entry |
| V2 | S2 | BR-9: a fixture module exporting the wrong shape fails to compile, naming its file |
| V3 | S3 | BR-4 and BR-10 refuse, naming both files. The negative control: remove the rule and watch the fixture pass silently |
| V4 | S4 | BR-6: `--check` red on a changed tree, green after regenerating |
| V5 | S5 | BR-7, BR-8. A capability's declared resources reach a real `defineFlow`; a module resource lands in the same map as a document |
| V6 | S6 S7 | BR-12 through BR-15. BR-14 asserted **at hire**, not at turn time — the test that fails a typo must fail before any request runs |
| V6a | S7 | BR-22: a seat naming a preset that is already on by default gets that preset's context and tools **once**. Planted duplicate seen first, so the check is known to fire |
| V7 | S7 | BR-16, BR-17: a seat with `tools: []` and a tool-bearing selection reaches zero tools. **Conditional — see *At implement time*.** If the core fence is not on `main` when P3 starts, this check and BR-16–17 leave P3's scope entirely. They are never weakened to pass, and the fence is never reimplemented here |
| V8 | S8 | Door A's existing suite unchanged (BR-18, BR-19) — run before S1 and after S8, same result |
| VG | S9 | Goal, real path: one capability added to a team folder; two seats of one kind, one naming a preset and one naming nothing; each answers with only what its own file gave it. New goal beside the two `workforce-conventions` goals |

**Negative control, run.** V3 and V6 exist to catch a silence, so each is seen red first: plant the
colliding pair, plant the misspelled preset, watch each fail, remove them (tenet 7).

## The pinned constraint · one resolution path

Two facts about core, both read off `main` today:

- **Static and dynamic `uses` are resolved independently and never deduped across the two.** The
  generator builds its tool list as `[...declared, ...staticCapTools, ...dynamicCapTools]`, and the
  context list the same way. So the obvious shape — install a capability statically for its
  resources and re-add it dynamically for the seat's presets — resolves an already-default preset
  **twice** for a seat that names it.
- **A capability that declares open config throws when reached through a dynamic resolver.** So a
  discovered capability written as a factory cannot have its behaviour resolved on that path at all.

The plan does not pick the mechanism; it pins the property. **A capability contributes its presets
through one path per seat, and its resources reach the flow regardless of what a seat selects.**
The two candidate shapes are a resources-only static entry (presets off, behaviour dynamic) and an
all-static shape whose entry is built per seat. The first needs a way to install a capability's
resources without activating its default presets, which does not exist today and belongs in core's
capability surface rather than being re-derived in `workforce`. Settle it in code, against V6a.

## Pinned names · the only two

| Where | Name | Why pinned |
|---|---|---|
| A worker's file | `capabilities:` | Public. A person types it, and it has to read as the sibling of `skills:` |
| The generated module | `resourceModules` | Public. An app imports it beside `kinds` and `blocks` |

Everything else is yours to name.

## Guardrails

| Rule | Because |
|---|---|
| The two doors stay two readers over one set of shared walk primitives | One reader holding both conventions is the mega-loader the primitives extract exists to prevent |
| Nothing in a shipped package imports a path it discovered | That property is what makes a bundled build behave like a local one. It is the whole of D1 |
| One rule mints every ref in this tree, documents and modules alike (tenet 5) | Two spellings of one ref is how a module and a document silently overwrite each other, and S3 can only refuse what it can see |
| A bad name in a worker's file refuses at hire, never mid-turn | The per-seat resolver runs inside a request, and a typo surfacing as a failed answer is worse than the bug this closes |
| Door A's suite runs unchanged before anything is added, and again at the end | Released behaviour. "We didn't mean to change it" is not evidence (BP-030) |
| A capability's tools still pass through the seat's `tools:` list | Selecting is not widening. The fence is the claim this package publishes hardest |
| One resolution path per capability per seat | Core resolves static and dynamic `uses` independently and does not dedupe across them, so a capability on both paths contributes its presets twice (verified below). Two paths also means two answers to "what does this seat carry" |
| A check that cannot fail is not written | Both V3 and V6a exist to catch a silence, and V7's whole value is that it can go red. Rewriting a check so it passes against behaviour the fence has not landed yet is the failure this plan is guarding against |

## Docs

- **CREATE** `apps/docs/docs/workforce/capabilities-on-disk.md` — the `.ts` door: what a module may
  export, why the command runs, what a seat's `capabilities:` key does. Sidebar: the `Workforce`
  category, immediately after `workforce/documents-on-disk`, where a reader meets the folder first.
  *Voice risks:* define **capability** and **preset** plainly on first use; not "seamless" or
  "powerful"; no issue or PR numbers on the page.
- **EXTEND** `apps/docs/docs/workforce/documents-on-disk.md` — two or three sentences where it says
  a document is a `.md` file, on what a `.ts` file beside it means now. Not a second copy.
- **EXTEND** `packages/workforce/README.md` (the module half and the seat key) and
  `packages/cli/README.md` (the command's fourth family).
- **One `minor` changeset** for `workforce` and `cli` — published packages, consumer-visible
  surface (BP-022).

## Sketch · pseudocode, illustrative, react to the shape

```
at generation:
    for each resources/ folder the convention reads:
        for each entry:
            .md  -> the document walk's, untouched
            .ts  -> this walk's: mint the ref from the path, record the import
    refuse any ref claimed by both walks
    render one more map: ref -> the module's default export

at install (the app's own call site, visibly):
    capabilities, resources <- split(resourceModules)
    kind = defineAgentWorkerFlow({ uses: [...capabilities], ... })
    flow resources = { ...resourcesFromDocs(documents), ...resources }

at the mint, per seat:
    for each (capability, presets) the seat's file names:
        refuse if the kind carries no such capability      (BR-13)
        refuse if the capability declares no such preset   (BR-14)

per turn, in the kind's capability slot:
    the kind's static entries, as today
    plus, for this seat only, each named capability with its named presets
```

**No POC.** Every premise this rests on is already running code: the build-step discovery
convention, the kind's capability option, the per-seat switches on the skills key, and the
published walk primitives. Nothing here is a claim nobody has checked.

## At implement time

- **The tools fence may have moved, and the fallback is to drop the rules, not to weaken them.**
  FIX-1393 (#1852) is in review; BR-16 and BR-17 are its behaviour. Today core returns
  `[...declared, ...staticCapTools, ...dynamicCapTools]` — a union — so a seat with `tools: []` and
  a tool-bearing selection **does** receive that tool. Asserting "what the kind honours today"
  would therefore mean rewriting V7 until it passes against the hole it exists to catch. So: if the
  fence is on `main` when P3 starts, assert against it. If it is not, **drop V7 and BR-16–17 from
  P3's scope** and say so in the PR. Context-only preset selection still delivers the whole
  seat-differentiation story, and the fence is never reimplemented in `workforce`.
- **The shared walk primitives are on `main`**, but FIX-1389 is still in development and carrying
  follow-ups. Consume its published primitives — root open, team walk, path classification, the
  ignored-name list, the segment rule — rather than growing a parallel walk, and do not
  parameterise an existing reader.
- **The reference app's workforce tree is reachable from nothing** — imported by no entry point and
  absent from the Next build, already recorded against the code-convention goal. Shape VG on the
  real hire-and-answer path, and do not take that blocker on here.

## Notes from review

- "Soft preference: fold P1+P2 if one EM wants a shorter path (Install is thin); three PRs OK if
  P1's checks are real." — FSD Architect ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/1858#issuecomment-5720663182))
- "Whether `resourceModules` needs to be a public export on day one." — review round 2
- "A failure-channel table would cut the repetition across the four documents." — review round 2
- "The kitchen-sink workforce subtree is inert; follow it up separately." — review round 2

Inputs, not instructions. Adopt, adapt or discard; you owe no justification for discarding one.

## Follow-ups

- The reference app's workforce subtree demonstrates the convention and is executed by nothing.
  Recorded against `goals/workforce-conventions/code-comes-from-files-alone/goal.md`; Door B makes
  it more visible, and it wants its own issue.
- Two `validateSegment` functions in two packages enforce overlapping rules and cannot see each
  other. Recorded on the same goal; out of scope here.
- Seat-scoped capability install — giving one seat behaviour its kind does not carry. BR-21 refuses
  it loudly rather than guessing. File when a concrete seat needs it.
