# FIX-1351 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that's each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n)
and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path: twelve lanes against time, done bars for the kinds fence, skills, ChannelFlow, channels and resources behind the now line at September 17, the loader extract in implementation across the now line, the WorkerConfig admission, the boot scan and the atlas spec-approved and held on it, worker resources, TEAM.md and the pentest lab Proof in spec review ahead of it, and the lab's required bar last, with the critical path drawn through the three conventions to the lab](figures/path.svg)

Twelve lanes, one per committed deliverable that is still live — the three carried-along
sub-issues have none, because nothing waits on them. Five are behind the now line; one crosses it
(the loader extract, in implementation); three sit on it **spec-approved and held**; three are in
spec review ahead of it. The critical path is short and already clear: the three conventions land,
and the lab proves them. What the picture shows that the set table can't is the shape of the delay
— every convention shipped before its consumer, which is the risk D1's necessity check accepted
and ER-15 is the tripwire for. The dependency graph itself is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this document adds time to it.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1342** kinds fence | spec → impl | The shipped `WORKER.md` loader | Seats stay `WORKER.md`; custom kinds are flow factories (ER-5) | FIX-1311 · FIX-1357 | Medium |
| **FIX-1356** skills | spec → impl | The `org/` precedent it also sets (ER-1) | The per-seat skills register over org ∪ team ∪ worker-local | FIX-1367 | Medium |
| **FIX-1311** ChannelFlow | spec → impl | D1 · D2 · D5 · the fence | The default kind, its two-phase binder, `ChannelManifest` and the `system:` refusal | FIX-1352 | Large |
| **FIX-1352** channels | spec → impl | The kind (D2) · `ChannelManifest` · D3 | `CHANNEL.md` at **team** scope, and the walk primitives the others consume — the `org/` door is unbuilt ([Open 5](DECISIONS.md#open)) | FIX-1355 · FIX-1358 · FIX-1389 | Medium |
| **FIX-1354** resources | spec → impl | The walk primitives · D4 | Markdown documents under `resources/`, org and team — **Door A** | FIX-1368 · FIX-1389 | Medium |
| **FIX-1367** admission | spec → impl | The skills register (ER-7) | Hire invoking the flow with a config the kind admits — the seat's skills bag, on every record | The lab's honesty claim · FIX-1377 | Small |
| **FIX-1355** lab Proof · **required** | spec → goal check | All three conventions · FIX-1367 | One thin pentest lab, declared in files, multi-seat on the real path | The epic's wrap | Medium |
| **FIX-1357** boot scan | spec → impl | D6's locked folder | One scan, three maps — worker kinds, channel kinds, blocks | Custom kinds without hand-passed maps | Medium |
| **FIX-1358** atlas | spec → impl | D1 · D2 · D3 · D8 | The ChannelFlow teach and the full-tree teach | Authors | Small |
| **FIX-1368** worker resources | spec → impl | FIX-1354's reader | `workers/<name>/resources/` as a third root | — | Small |
| **FIX-1377** `TEAM.md` | spec → impl | D8 · FIX-1367's contract key · FIX-1389's team enumerator | Optional team instructions and the locked prompt order | — | Small |
| **FIX-1389** loader extract | spec → impl | Four shipped readers | One tree-walk mechanism with thin per-slot adapters (ER-10) | FIX-1377 | **Small** |

**Not in this table:** FIX-1388 (resources Door B), removed from the epic by the owner; and the
three carried-along sub-issues (FIX-1412, FIX-1414, FIX-1416), which the epic does not schedule
and nothing here waits on. They are listed in [the spec's second table](SPEC.md#the-set--as-of-2026-09-17).

## Where it is

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-17). The
lanes above carry the same state as a picture of time and are redrawn when it moves. The inputs
from other epics: W2's hire and loader spine
([#1664](https://github.com/fixpoint-labs/flow-state-dev/pull/1664)) is merged and consumed
without re-parenting; the agent-kind epic's admission work (FIX-1359 / FIX-1361) runs in parallel
and FIX-1367 does not wait on it.

## What unblocks what, from here

1. **Nothing blocks FIX-1355.** Every convention it consumes is Done, and FIX-1367 is a
   **compatibility** edge, not a blocking one — the lab does not wait on admission, it only has to
   stay valid once admission ships. The lab is the next thing the epic needs, and it is the only
   one whose absence stops the epic finishing (ER-19).
2. **Three specs are approved and held short of implementation** — FIX-1367
   ([#1807](https://github.com/fixpoint-labs/flow-state-dev/pull/1807)), FIX-1357
   ([#1804](https://github.com/fixpoint-labs/flow-state-dev/pull/1804)) and FIX-1358
   ([#1805](https://github.com/fixpoint-labs/flow-state-dev/pull/1805)), all closed unmerged,
   each pending an owner re-confirm. FIX-1367 is what discharges ER-15 for skills; FIX-1358 puts
   ER-22's teach on the floor.
3. **FIX-1377 is hard-blocked by FIX-1367 and FIX-1389**, recorded in Linear. FIX-1367 owns the
   contract key the team layer rides; FIX-1389 owns the team enumerator its reader sits on.
   FIX-1377's spec records a fallback if FIX-1389 slipped — widen the shipped worker reader — and
   that is **a recorded re-decision, not a licence**: taking it re-scopes a merged reader and
   re-opens FIX-1389's D1 trade, so it goes up before it is taken. **Moot today**: FIX-1389 is in
   implementation.
4. **FIX-1355 needing a shared infrastructure seat** → and only then, a reader for `org/workers/`
   goes on the floor (D7).
5. **FIX-1311 + FIX-1361 + FIX-1367 all merged** → the duplicated absent-`flow:` rule is extracted,
   as a tracked follow-up rather than during three in-flight edits of `hire.ts`.
6. **Nothing owns the `org/` channels door, and its tripwire has now fired negative.** It was left
   unfiled on D7's shape — the lab wanting a company-wide channel would put a reader on the floor.
   FIX-1355's spec [declines one by name](https://github.com/fixpoint-labs/flow-state-dev/pull/1809)
   and opens a declared **team** channel instead, so nothing in the set will force the question
   ([Open 5](DECISIONS.md#open)). FIX-1358 still draws it as a named gap (ER-22) and the set still
   says team scope — but "wait for the lab" is no longer a plan.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| `packages/workforce/src/manifest.ts` | FIX-1311 and FIX-1352 | 1311 declares `ChannelManifest` and the `system:` wording; 1352's reader imports them and does not re-declare |
| The shared tree-walk | FIX-1352, FIX-1354, FIX-1356, FIX-1357 | Each consumes primitives; FIX-1389 owns the extract. No child generalises a slot reader (ER-10) |
| **Publishing the loader primitives** (the `loader` export map, and collapsing the three ignore lists into one) | **FIX-1357 and FIX-1389** | Both specs carry the same publication — FIX-1357's S1 and FIX-1389's S6 — and both say the same thing: **whichever lands first does it**, and the second takes the export as given and writes nothing. FIX-1389 is in implementation, so it lands first |
| `hire.ts` | FIX-1367, FIX-1377, and FIX-1361 outside the epic | Three edits in flight. The absent-`flow:` duplicate stays until all three land. FIX-1377 is blocked behind FIX-1367 here, so the two are sequenced rather than concurrent |
| `resources/` as a folder | FIX-1354, FIX-1368 | Door A is Markdown documents; worker level is a third root. Door B left the epic with FIX-1388. Two readers, one folder — each states which files it claims |
| `org/` scope across the conventions | FIX-1352, FIX-1354, FIX-1356 | Resources and skills read `org/`; channels does not. Whoever closes the channels org half consumes the same walk primitives and does not invent a second org walk (ER-10) |
| **`packages/workforce/README.md` and the `apps/docs` Workforce section** | **FIX-1357 and FIX-1367** | Both EXTEND the package README and the same docs section — FIX-1357 on the scan and `fsdev gen`, FIX-1367 on what a hireable kind must admit. Whichever lands second links rather than repeats, and neither lands ahead of its reader (ER-18). FIX-1358's atlas teach sits above both and is the same rule |

## Not children, deliberately

[FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) (**W4 — work routing & package
cohesion**): its ship tickets are soft-*after* this epic; planning and parallel POCs are fine now.
It is a sibling epic, never re-parented here.
[FIX-1388](https://linear.app/fixpoint-labs/issue/FIX-1388) (**resources Door B**) was a child and
**was removed from this epic by the owner**; Door A stands, and capability and resource modules
are no longer this set's scope. Also consumed, not owned:
[FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341) (Collab RC),
[FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333) (MCP),
[FIX-1325](https://linear.app/fixpoint-labs/issue/FIX-1325) /
[FIX-1335](https://linear.app/fixpoint-labs/issue/FIX-1335) (W2's hire and loader, where
`TEAM.md`'s composition and any `org/workers/` reader land), and FIX-1359 / FIX-1361 (the agent
kind).

## Wrap

When ER-19 holds: run the lessons pass over the set's review rounds; dispatch the docs polish
over the Workforce pages the children each edited in isolation — it owes two sentences nobody
else will write, that the three conventions are **deliberately asymmetrical** (folder-per-thing
for channels and skills, file-per-thing for resources; skills older and external; `org/` read for
resources and skills but not yet for channels), and that
`teams/<id>/skills/` means *this team* by narrowing what a seat reads, not by owning a namespace.

**One correction the epic owes, and it is not a docs-polish nicety.**
`docs/atlas/workforce.html` §19 gap 6 still reads *"`flowIsolation` exists and keys per flow kind,
not per seat"* and is stamped **NAMED GAP · PROVE flowIsolation FIRST · PER KIND, NOT PER SEAT**.
That is the **pre-FIX-1323 bug**, fixed: isolation keys per flow *instance*, and hire mints one
instance per seat — proved on the real path (DECISIONS → *Decided in review*). An
authority-level-2 document describing a fixed bug as a live gap already misled three reviewers on
FIX-1368's D2. Fix the entry; do not let the polish pass treat it as prose.

Then refresh the set table and the path one last time, and close the epic PR unmerged.
