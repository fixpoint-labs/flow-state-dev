# FIX-1527 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Each rule says what a person or the system does, and what happens. The *proved by* column
names the check [PLAN.md](PLAN.md) runs. Rules marked *consumed* are the capability's contract.
This issue relies on them and doesn't test them again.

## Hiring through mara

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Mara calls `hire` for a kind the app carries, under a named organization | The seat answers at `<org>.<seatId>`, one org-visible roster row exists, and the app records the address as roster-minted | V1 |
| BR-2 | Mara calls `hire` under the development organization. That is every kitchen-sink run until FIX-1500's PR-B lands, and every `fsdev run` after it | Refused before any write. No roster row, no inventory row, nothing registered. The error names the organization | V2 · VG (refusal form) |
| BR-3 | Iris, otto, or any agent seat that doesn't name `hire` | Can't hire, though its kind offers the tool | V3 |
| BR-4 | Mara hires an unknown kind, a live address, or with no organization | Refused, writes nothing | Consumed: package suite |
| BR-5 | Mara hires a seat with `tools: [hire]` in its settings | That seat can hire too. Nothing here narrows it (D1 → *Locks in*) | V6 |
| BR-6 | Mara hires `desk-clerk` or `followup-runner` | Offered, because mara's hireable set is the operator's, from the one kinds map | V4 |

## After the hire

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | The app restarts after mara hired a seat | The existing boot reload brings it back and it answers again | V5 |
| BR-8 | Any agent seat calls `discover` after mara's hire | The hired seat is listed. File-declared seats are not, because kitchen-sink writes no inventory rows for them | V1 |
| BR-9 | Mara fires a seat she hired | Address released, roster row gone, `discover` withholds it. The inventory row remains ([FIX-1540](https://linear.app/fixpoint-labs/issue/FIX-1540)) | V1 |
| BR-10 | The operator fires, over `workforce-admin`, a seat mara hired | Fired and released, the same as a seat reloaded from the roster | V7 |
| BR-11 | Mara fires a seat the operator hired | Refused as "hired no seat". The operator's rows are user-owned, and the capability reads only org-visible ones | V7 |
| BR-12 | Mara fires a file-declared seat such as `support.ada` | Refused: removed by editing its folder | Consumed: package suite |
| BR-13 | Mara fires a seat she hired, and its address is now held by a registration the roster did not make | The roster row goes. The other registration stays, and the fire reports `released: false` | V9 |

## Failure taxonomy

Every refusal is per call and writes nothing. The one kitchen-sink will actually hit is BR-2.
It's expected in the default run until FIX-1500's PR-B gives the app its one organization, and
from `fsdev run` after that ([F1](DECISIONS.md#f1), answered *ship*). A failing `register` deletes the row it just wrote (consumed). Nothing
retries. Boot doesn't change: mara is one more file-declared seat, and a bad hired row is
skipped and named by the existing reload.

## Acceptance criteria this issue owns

- A kitchen-sink test runs **mara, as the app composes her**, through a hire, a `discover` and
  a fire under a named organization, and through a refused hire under the development one.
- On the real path, mara under a real model is asked to hire and calls `hire`. F1 was answered
  *ship*, so until FIX-1500's PR-B lands the run ends in BR-2's refusal and writes nothing. Once
  PR-B lands, VG re-runs and passes on a hire followed by `discover` listing it.
- "Written" and "nothing written" are read from the store, with no model involved. The model's
  own transcript is not the evidence.
- The kitchen-sink README says, in its words, what mara can do and when she can't.
