# FIX-1592 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child
spec and implementation must satisfy, and the place a cross-spec review checks. Each says who
owns it and where it's checked. FIX-1585's own BR-n stay in its spec; this set consumes them.

## What a person gets, and what they don't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | A note to a `desk-clerk` seat gets an answer written by a model, never the note echoed back | FIX-1589 | FIX-1589's browser check · its real-model goal |
| ER-2 | The clerk either answers or files. A filed note becomes one row on `followups` or `escalations` through the channel's own `fileTask`, and the person's conversation says it was filed and where | FIX-1589 | FIX-1589's browser check |
| ER-5 | A person can pick up an `escalations` row from the board panel and settle it. The `followups` drain can be run from the board panel. `support.wren` still has no composer (FIX-1585 BR-15) | FIX-1591 | FIX-1591's browser check |
| ER-6 | One kind→action map, FIX-1585 D3's, for the seat composer and any later consumer | FIX-1585 decides · FIX-1589 consumes | FIX-1589's spec review · FIX-1585's drift test |
| ER-7 | The only package change in the set is FIX-1585 D1's `expose: ["transcript"]` line on the channel kind | FIX-1585 | Every child's spec review · the Kill line |
| ER-8 | The rows on both boards come from one producer: the clerk's filing | FIX-1589 decides · FIX-1591 consumes | FIX-1591's spec review |

ER-3 and ER-4 left the set with FIX-1590 ([D1](DECISIONS.md#d1)); the numbers are not reused.

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-9 | No kitchen-sink-only route or messaging API. Every browser verb calls an action a flow already declares | Architect fence. A reference app with a private API teaches the private API |
| ER-10 | No Workforce Layer 2 concept in core or engine, and no new Layer 1 Channel, Notify or Dispatcher piece | Architect fence |
| ER-11 | No edit to `packages/workforce/src/agent-worker-flow.ts` until FIX-1459 lands | Another thread is implementing FIX-1459 in that file |
| ER-12 | No change to the notify stub: a post still wakes no seat (FIX-1590, a follow-on); no Assistant tool that posts or asks; no channel create, delete or invite (FIX-1415); no verified per-participant identity (FIX-1493) | Not doing. Each is its own decision |
| ER-13 | No child widens FIX-1585's spec or PR #2258 | Cycle PM fence. Follow-ons land in their own issues |
| ER-14 | No child re-creates an unattended board in kitchen-sink to keep the retired demo | D3. The framework's own test carries the warning |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-15 | FIX-1589 starts when FIX-1585's implementation merges; FIX-1591 starts when FIX-1589's does. Wired in Linear as blocked-by | D1. A spec merge is not a start signal |
| ER-16 | A child that finds it needs a package change beyond ER-7, or a live key to pass one of its keyless browser checks, stops and comments up on this epic. The real-model goal (ER-18) needs a key by design and does not trip this | The Kill line. Deciding it locally hides the one fact that ends the epic |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| ER-17 | In a browser on kitchen-sink: a post to `support.desk` is seen in that stream; a seat asked a question has its reply seen; a note to `support.ada` gets a model-backed answer, or lands on `followups` and `support.wren` drains it; a person picks up an `escalations` row from the board panel. All keyless, under `KITCHEN_SINK_TEST_MODE=1` | FIX-1585's two browser checks · FIX-1589's · FIX-1591's |
| ER-18 | The clerk answers or files correctly on a real model | FIX-1589's goal under `goals/` ([D4](DECISIONS.md#d4)) |
| ER-19 | The workforce-shell checks and the `a-channel-holds-the-work-a-seat-drains` goal are green, with V8 and V9 amended as D3 says | FIX-1591's PR · CI |
| ER-20 | Kitchen-sink's README tells a reader the desk is used from the browser, and no longer says `escalations` is unwired | [DOCS.md](DOCS.md) · FIX-1591 publishes last |
