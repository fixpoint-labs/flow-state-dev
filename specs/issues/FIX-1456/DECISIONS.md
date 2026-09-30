# FIX-1456 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

The FSD Architect's fence is binding. Align `validateSkillName` with workforce's
`DOS_DEVICE_SEGMENTS`, with no exemption for skills. Don't fold this into FIX-1428, don't create
a shared package, and don't have `orchestration` import `workforce`. A temporary third copy of the
list is fine.

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

- **E1 · Copy the list locally, don't import it.** The copy sits in `skill-md.ts` next to
  `RESERVED_NAMES`. Its comment names the other two copies and points to FIX-1428 for the dedupe.
  The copy is temporary. It is not a new canonical home.
- **E2 · Numbered devices run 1–9, the same as workforce.** `com0` and `lpt0` are ordinary names
  on Windows, so they stay legal.
- **E3 · The error gives the reason.** It says "is a reserved device name on Windows", using
  workforce's wording, so the author learns why the name failed and doesn't just see "reserved".
- **E4 · The load and run tools refuse these names too.** They call the same validator, and once
  seeding refuses such a skill it can't exist. They need no special case.
- **E5 · Update workforce's comment.** The comment on `DOS_DEVICE_SEGMENTS` says the list also
  lives in `engine`. It will name `orchestration` as well (BP-034 provenance).

## Open

None.

## How it got here

- **Draft:** written from the issue, the Architect's fence, and `main` at `67a3bb9b`.
