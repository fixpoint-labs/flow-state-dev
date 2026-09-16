# FIX-1351 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that's each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n)
and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path: thirteen lanes against time, done bars for the kinds fence, skills, ChannelFlow, channels and resources behind the now line at September 16, the WorkerConfig admission and the atlas spec approved and the boot scan still in spec review on the now line, empty lanes ahead of it for worker resources, TEAM.md, Door B and the loader extract, and the pentest lab Proof last, with the critical path drawn through the three conventions to the lab](figures/path.svg)

Five lanes are behind the now line, three opened a spec on it — two of them now approved and
waiting to be built — and five are ahead of it, none of them scheduled. The critical path is
short and already clear: the three conventions land, and the lab proves them. What the picture
shows that the set table can't is the shape of the delay — every convention shipped before its
consumer, which is the risk D1's necessity check accepted and ER-15 is the tripwire for. The dependency graph itself is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this document adds time to it.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1342** kinds fence | spec → impl | The shipped `WORKER.md` loader | Seats stay `WORKER.md`; custom kinds are flow factories (ER-5) | FIX-1311 · FIX-1357 | Medium |
| **FIX-1356** skills | spec → impl | The `org/` precedent it also sets (ER-1) | The per-seat skills register over org ∪ team ∪ worker-local | FIX-1367 | Medium |
| **FIX-1311** ChannelFlow | spec → impl | D1 · D2 · D5 · the fence | The default kind, its two-phase binder, `ChannelManifest` and the `system:` refusal | FIX-1352 | Large |
| **FIX-1352** channels | spec → impl | The kind (D2) · `ChannelManifest` · D3 | `CHANNEL.md` at **team** scope, and the walk primitives the others consume — the `org/` door is unbuilt ([Open 5](DECISIONS.md#open)) | FIX-1355 · FIX-1358 · FIX-1389 | Medium |
| **FIX-1354** resources | spec → impl | The walk primitives · D4 | Markdown documents under `resources/`, org and team — **Door A** | FIX-1368 · FIX-1388 | Medium |
| **FIX-1367** admission | spec → impl | The skills register (ER-7) | Hire invoking the flow with a config the kind admits — the seat's skills bag, on every record | The lab's honesty claim | Small |
| **FIX-1355** lab Proof · **required** | spec → goal check | All three conventions · FIX-1367 | One thin pentest lab, declared in files, multi-seat on the real path | The epic's wrap | Medium |
| **FIX-1357** boot scan | spec → impl | D6's locked folder | One scan, three maps — worker kinds, channel kinds, blocks | Custom kinds without hand-passed maps | Medium |
| **FIX-1358** atlas | spec → impl | D1 · D2 · D3 · D8 | The ChannelFlow teach and the full-tree teach | Authors | Small |
| **FIX-1368** worker resources | spec → impl | FIX-1354's reader | `workers/<name>/resources/` as a third root | — | Small |
| **FIX-1377** `TEAM.md` | spec → impl | D8 · hire's existing team walk | Optional team instructions and the locked prompt order | — | Small |
| **FIX-1388** Door B | spec → impl | FIX-1354's Door A · the scan family | Capability and resource **modules**: discover, install, select | — | Large |
| **FIX-1389** loader extract | spec → impl | Four shipped readers | One tree-walk mechanism with thin per-slot adapters (ER-10) | — | Medium |

## Where it is

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-16). The
lanes above carry the same state as a picture of time and are redrawn when it moves. The inputs
from other epics: W2's hire and loader spine
([#1664](https://github.com/fixpoint-labs/flow-state-dev/pull/1664)) is merged and consumed
without re-parenting; the agent-kind epic's admission work (FIX-1359 / FIX-1361) runs in parallel
and FIX-1367 does not wait on it.

## What unblocks what, from here

1. **Nothing blocks FIX-1355.** Every convention it consumes is Done. The lab is the next thing
   the epic needs, and it is the only one whose absence stops the epic finishing (ER-19).
2. **FIX-1367's spec is approved** ([#1807](https://github.com/fixpoint-labs/flow-state-dev/pull/1807),
   closed unmerged) — implementation is all it waits on now, and it is what discharges ER-15 for
   skills. **FIX-1358's is approved too**
   ([#1805](https://github.com/fixpoint-labs/flow-state-dev/pull/1805)), which puts ER-22's teach
   on the floor.
3. **FIX-1355 starting** → the [Open](DECISIONS.md#open) DM-opener question gets its answer, or
   gets skipped, at that moment. That is the tripwire, not a separate task.
4. **FIX-1355 needing a shared infrastructure seat** → and only then, a reader for `org/workers/`
   goes on the floor (D7).
5. **FIX-1311 + FIX-1361 + FIX-1367 all merged** → the duplicated absent-`flow:` rule is extracted,
   as a tracked follow-up rather than during three in-flight edits of `hire.ts`.
6. **Nothing owns the `org/` channels door.** Unfiled on purpose, on D7's tripwire shape
   ([Open 5](DECISIONS.md#open)): the lab wanting a company-wide channel is what puts a reader on
   the floor. Until then FIX-1358 draws it as a named gap (ER-22) and the set says team scope.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| `packages/workforce/src/manifest.ts` | FIX-1311 and FIX-1352 | 1311 declares `ChannelManifest` and the `system:` wording; 1352's reader imports them and does not re-declare |
| The shared tree-walk | FIX-1352, FIX-1354, FIX-1356, FIX-1357 | Each consumes primitives; FIX-1389 owns the extract. No child generalises a slot reader (ER-10) |
| `hire.ts` | FIX-1367, FIX-1377, and FIX-1361 outside the epic | Three edits in flight. The absent-`flow:` duplicate stays until all three land |
| `resources/` as a folder | FIX-1354, FIX-1368, FIX-1388 | Door A is Markdown documents; Door B is modules; worker level is a third root. Three readers, one folder — each states which files it claims |
| `org/` scope across the conventions | FIX-1352, FIX-1354, FIX-1356 | Resources and skills read `org/`; channels does not. Whoever closes the channels org half consumes the same walk primitives and does not invent a second org walk (ER-10) |
| The Workforce docs section | FIX-1358 and every convention's docs half | Whichever lands second links rather than repeats, and none lands ahead of its reader (ER-18) |

## Not children, deliberately

[FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) (**W4 — work routing & package
cohesion**): its ship tickets are soft-*after* this epic; planning and parallel POCs are fine now.
It is a sibling epic, never re-parented here. Also consumed, not owned:
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
Then refresh the set table and the path one last time, and close the epic PR unmerged.
