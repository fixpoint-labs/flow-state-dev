# FIX-1635 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 29 September 2026, in steps rather than dates because the epic is unscheduled. Shipped: FIX-1256, FIX-1261 and FIX-1510. Now: this spec in review. Step 1, in parallel: FIX-1018; the principal bugs FIX-1022, 1021, 1046 and 1328; the release bugs FIX-1431 and 1334; FIX-1628; the specs for FIX-1286 and FIX-1634; the closure QA plan. Step 2: FIX-1286 and FIX-1634 implement after FIX-1018 merges. Step 3: the closure run on one main commit, its PR, then wrap. The critical path runs through FIX-1018, FIX-1634's implementation and the closure run.](figures/path.svg)

A wide first step and one chain. Everything except two implementations can start at the
gate; the critical path is FIX-1018, then FIX-1634, the largest child, then the closure run.
The dependency graph is in [the spec](SPEC.md#how-the-issues-flow-into-each-other).

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1018** request id | direct | Current `main` (ER-17) | ER-3, and its case in the HTTP suite; the docs line (ER-20) | FIX-1286 · FIX-1634 | Medium |
| **FIX-1286** run workspace | spec → impl | ER-3 | ER-4, or a test proving ER-3 already delivers it | The closure | Small, or none |
| **FIX-1022** session key | direct | Current `main` | ER-5, with legacy keys still read by their owner | The closure | Medium |
| **FIX-1021** re-entry | direct | Current `main` | ER-6 | The closure | Small, likely a test |
| **FIX-1046** sibling flow | direct | Current `main` | ER-7 | The closure | Small |
| **FIX-1328** cross-flow admission | direct | FIX-1442's org rule | ER-8 | The closure | Small, likely a test |
| **FIX-1431** `dist` extensions | direct | Current `main` | ER-1, and leg a as a standing CI job, controlled by the 0.1.1 tarball | FIX-1334's check · the closure | Small, plus the job |
| **FIX-1334** DevTool assets | direct | Leg a's job | ER-2, as a check in leg a | The closure | Small, likely a test |
| **FIX-1634** queue delivery | spec → impl | ER-3 · FIX-1302's refusal | ER-11, Layer 1 only | The closure; later, a Workforce adopt child | Large |
| **FIX-1628** non-streaming text | direct | FIX-1626's join rule | ER-12 | The closure | Small |
| **FIX-1636** closure · required | spec (the QA plan) → runs until clean → PR | Every other child, merged, on one `main` commit · leg a's job · the children's HTTP suite | The suite run against installed tarballs with a real Redis (its QA plan says where CI gets it), a QA report, a bug child per finding | Wrap | Large, repeats per retest |

"Likely a test" is not a diagnosis. Each worker's **first step is reproducing the ticket's hole
on current `main`** (ER-17): FIX-1442, FIX-999's re-entry allow-list, the ESM-extension build
step and the release asset build all landed after these tickets were written.

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-29) is the review-time snapshot; follow its
Linear links for live state. Inputs from outside the set, all shipped: FIX-1442 (org required),
FIX-1302 (the `external-dispatcher` refusal FIX-1634 narrows), FIX-1626 (the streamed join
FIX-1628 matches).

## What unblocks what, from here

1. **This spec merges** → every child's spec or reproduction starts; the closure QA plan is
   written while they build.
2. **FIX-1018 merges** → FIX-1286 and FIX-1634 implement against its binding (D3).
3. **Every other child merges** → the closure runs on one `main` commit.
4. **A run files findings** → each is a child of FIX-1635 that blocks FIX-1636; the whole plan
   re-runs on a fresh commit when the last merges.
5. **A run files nothing** → the closure PR opens with the checks and the QA report.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The request write on the queue and external-dispatcher branches (`createInboundTransportHost`) | FIX-1018 and FIX-1634 | 1018 guards it first; 1634 delivers through it and keeps the guard |
| Session adoption checks (`createExecutionContext`) | FIX-1022 and FIX-1046 | Each adds its own binding beside user, tenant and org; whichever lands second rebases, never merges the two |
| Session and request routes' owner checks | FIX-1022, FIX-1046, FIX-1021 | Not-found for another user's record, one shape across all three |
| The run-scope key | FIX-1018 and FIX-1286 | 1286 changes it only if 1018's binding leaves a shared workspace |
| `server/authentication.md` | FIX-1018, FIX-1022, FIX-1046 | 1018 publishes the id rule; the others link to it |
| The publish path (`release:build`, CI's `dist` check) and leg a's job | FIX-1431 and FIX-1334 | One release build and one leg a job: 1431 creates it, 1334 adds to it, neither adds a second |
| The shared HTTP suite | FIX-1018, 1286, 1022, 1021, 1046, 1328, 1634, 1628 and FIX-1636 | One location. The first child to land creates it; each adds only its own case; the closure runs it and never rewrites a case |

## Not children, deliberately

The Tier B leftovers (FIX-1002 family and the owner's list), FIX-1591, FIX-1631 to 1633,
FIX-1621, FIX-1161's publish and ops work, and the Workforce adopt child for FIX-1634 until
its Layer 1 shape merges.

## Wrap

When ER-19 and ER-20 hold: the lessons pass, a docs polish over the authentication and background-work
pages, and a completion report in Linear. The original merged spec PR stays as the review
record.
