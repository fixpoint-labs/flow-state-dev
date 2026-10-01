# FIX-1456 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

The FSD Architect's fence is binding. Align `validateSkillName` with workforce's
`DOS_DEVICE_SEGMENTS`, with no exemption for skills. Don't fold this into FIX-1428, don't create
a shared package, and don't have `orchestration` import `workforce`. A temporary third copy of the
list is fine.

> **Amended 2026-09-30.** FIX-1428 has since merged
> ([#2499](https://github.com/fixpoint-labs/flow-state-dev/pull/2499)): one shared
> `isWindowsReservedName` in `@flow-state-dev/contracts/helpers`, re-exported from
> `@flow-state-dev/core/helpers`, and a CI guard (`scripts/validate-reserved-names.mjs`) that fails
> on any other copy of the list. A follow-up Architect fence (agent mailbox, 2026-09-30) directs
> this issue to call that helper and ship no local copy. The fence text above is kept as it was
> when this spec merged; E1 and E5 below record what it changed. D1 and every user-visible
> behaviour, including the error text, are unchanged.

<a name="d1"></a>
## D1 · Decided: skills refuse device names, with no grace period

From this release on, a skill named `con`, `prn`, `aux`, `nul`, `com1`–`com9` or `lpt1`–`lpt9`
fails validation.

- **Instead of:** exempting skills, which the fence forbids, or warning for a release before
  refusing. A warning keeps a name that breaks Windows checkouts loading, and nobody is known to
  need the extra time.
- **Why this isn't a sign-off ask:** Jake's trade-off on the issue already accepts the break,
  and the fence fixes the direction. No tracked file in this repository uses a device name
  (`git ls-files` finds none).
- **Locks in:** a skill with one of these names stops loading. A changeset tells consumers.

## Engineering calls

- <a name="e1"></a>**E1 · Call the shared list; keep no copy.** *(Amended 2026-09-30.)*
  `validateSkillName` calls `isWindowsReservedName` from `@flow-state-dev/core/helpers`, after the
  name-pattern check. The helper folds case, so that order keeps `CON` on the existing "must be
  lowercase" message and only a lowercase device name reaches the device check. `orchestration`
  already depends on `core`, so this adds no package edge.
  - *Superseded:* "Copy the list locally, don't import it. The copy sits in `skill-md.ts` next to
    `RESERVED_NAMES`. Its comment names the other two copies and points to FIX-1428 for the
    dedupe. The copy is temporary." That was right while no shared list existed. Once #2499
    landed, a local copy would fail its CI guard, and the follow-up fence asks for the import.
- **E2 · Numbered devices run 1–9, the same as workforce.** `com0` and `lpt0` are ordinary names
  on Windows, so they stay legal.
- **E3 · The error gives the reason.** It says "is a reserved device name on Windows", using
  workforce's wording, so the author learns why the name failed and doesn't just see "reserved".
- **E4 · The load and run tools refuse these names too.** They call the same validator, and once
  seeding refuses such a skill it can't exist. They need no special case.
- <a name="e5"></a>**E5 · No workforce edit.** *(Amended 2026-09-30.)* There is no second copy
  whose comment needs to name this one.
  - *Superseded:* "Update workforce's comment. The comment on `DOS_DEVICE_SEGMENTS` says the list
    also lives in `engine`. It will name `orchestration` as well (BP-034 provenance)." #2499
    removed `DOS_DEVICE_SEGMENTS`; workforce now calls the shared helper, and its comment already
    points there.

## Open

None.

## How it got here

- **Draft:** written from the issue, the Architect's fence, and `main` at `67a3bb9b`.
- **Post-merge amendment (2026-09-30):** E1 and E5 superseded after FIX-1428
  ([#2499](https://github.com/fixpoint-labs/flow-state-dev/pull/2499)) landed the shared helper
  and the follow-up fence asked for the import. Original review:
  [#2470](https://github.com/fixpoint-labs/flow-state-dev/pull/2470).
