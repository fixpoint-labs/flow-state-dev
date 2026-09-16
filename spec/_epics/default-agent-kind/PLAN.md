# FIX-1359 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails. It does not say how to build any piece; that was each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n). The epic wrapped on 2026-09-16; this is the plan's final state.

## The path

![Swimlanes against time, final: two input lanes from other epics, seven issue lanes in chain order, every bar done, skills and memory side by side from the fourteenth, the proof last on the sixteenth, a wrap line closing the chart, and the critical path drawn through audit, contract, kind, skills and memory, and proof](figures/path.svg)

A chain, not a fan-out. Only the first two issues could start at the gate. The one real parallel window was skills beside memory once the kind existed, and that is where the set spent its middle two days. Required did not move the proof earlier: it waited on both, then ran last and passed. Six days from gate to wrap. The dependency graph itself is in [the spec](SPEC.md#how-the-issues-flowed-into-each-other); this document added time to it.

## What each issue entailed

| Issue | Route | Consumed | Delivered | Released | Size |
|---|---|---|---|---|---|
| **FIX-1360** drift audit | spec → docs PR | `apps/kitchen-sink` chat-agent and skill activator | A dated drift note: what not to copy, the named gaps, what KS still proves, what to re-home | FIX-1361 | Small |
| **FIX-1361** contract | spec → docs PR | The drift note · D2 · D5 | A locked contract for the kind: admission, loud-fail, the built-in id `agent`, decision 2's fence, the skills isolation contract | FIX-1363 | Small |
| **FIX-1363** the kind | spec → impl PR | The contract · W2's default prompt through a seam (D3) | The built-in `agent` flow kind: talks, consumes the prompt, no memory wired. The admission and loud-fail paths built | FIX-1362 · FIX-1364 · FIX-1366 | Medium |
| **FIX-1362** per-seat skills | spec → impl PR | The kind · W3's skills convention · the isolation contract | Skills bound per seat with real storage isolation, three activation paths, the merge rule, refresh | FIX-1365 (with 1364) | Medium-large |
| **FIX-1364** memory seam | spec → impl PR | The kind · D4 | The named build-time composition seam, narrowed to `uses:` alone in review, the gap list, how-you-attach teaching | FIX-1365 (with 1362) | Medium |
| **FIX-1366** teach | spec → docs PR | The kind · the contract's vocabulary | The overview leads with the zero-code hire; the reference is complete; the Atlas stops teaching the killed factory. Grew the section that already existed rather than adding a page | Nothing; a leaf | Small |
| **FIX-1365** proof · required | spec → goal check | A roster · the kind · skills · the seam | One real hire of the built-in on the real path, graded on the model's replies, with three negative controls | The epic's wrap | Small |

## Where it ended

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-16--final). The swimlanes above carry the same state as a picture of time; this is their last redraw. The two inputs from other epics: W2's default prompt never shipped during the epic, so the kind ships against `instructions` with a seam (D3) and still consumes it that way; W3's skills convention was done before the gate and FIX-1362 consumed its load rules.

## How the unblocking ran

1. **FIX-1362 and FIX-1364 merged** (Sep 15–16) → FIX-1365 started the same night. Nothing else was waiting on them.
2. **FIX-1366's spec was approved** (Sep 15) after two review rounds reversed its direction from a new page to growing the existing one. Its docs PR ran beside the last of the substance and gated nothing.
3. **FIX-1365's goal check passed** (Sep 16) → the epic wrapped: lessons pass, docs polish, this final refresh, and the epic PR closed unmerged.
4. **W2's default prompt did not land during any of this.** The seam in FIX-1363 is still where it will go. No child re-sequenced.

## Coordination seams, and how they held

| Seam | Between | Rule | Outcome |
|---|---|---|---|
| Memory teaching | FIX-1364 and FIX-1366 | Current behaviour in 1366, how-to in 1364. Whichever lands second links rather than repeats | 1366 landed first and stated the no-memory line in three places; 1364 linked |
| The contract file rename | FIX-1366 and FIX-1362 | 1366 renames it; 1362 edits its C5 in the impl PR. Find it by content, not path | Renamed to `workforce-default-worker-kind.md`; both inbound references moved |
| The skills entry points | FIX-1362 and FIX-1366 | 1362 pins which one the built-in uses; deprecation is not this epic | Filed as FIX-1390 and, by accident, FIX-1391; a dupe pair to reconcile |
| The `tools:` fence hole | FIX-1366 and core | Teach the guarantee and name the hole; enforcement is FIX-1393 | Taught as a hard fence with the hole named; FIX-1393 still Todo |

## Not children, deliberately

FIX-1344 (W2 soft dep) · FIX-1356 (W3 convention) · FIX-1355 (W3 lab) · FIX-1367 (thin `WorkerConfig`, W3 hire admission) · FIX-1388 (Install on the kind; its written plan was corrected to `uses:` alone) · FIX-1393 (fence enforcement in core, filed from the Sep 14 ruling) · FIX-1387 (Atlas voice, filed by 1366). Linked from the rules, never re-parented (ER-10).

## What the wrap left behind

Four follow-ups filed under the epic, none blocking:

- **FIX-1403 · High.** A caller supplying only a `userId` gets `Resource "skills" is not registered` before the model is reached, because the kind's skills collection defaults to org scope. Found by the first thing that hired a zero-config worker and asked it a question. This is the one gap between the epic's plain-language promise and what a zero-config caller gets.
- **FIX-1402 · Low.** The contract doc still frames shipped behaviour as "after".
- **FIX-1390 / FIX-1391.** The two skills entry points, filed twice. Reconcile one, close the other.

Two rework classes go to `distill-lessons`, both named in [DECISIONS.md](DECISIONS.md#how-it-got-here). ER-17 held: the proof passed, the epic PR closed unmerged, the branch is retained.
