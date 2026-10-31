# FIX-2418 · Decisions

[Spec](SPEC.md) · **Decisions**

<a name="d1"></a>
## D1 · A per-browser *Show what's coming* setting, not `--dev`

| | Setting in Settings (chosen) | `shift-manager --dev` | Both |
|---|---|---|---|
| A daily user never sees gaps | yes | yes | yes |
| Someone checking what's coming can see them without a restart | yes | no | yes |
| New plumbing | none: browser storage, as the theme | a page meta from the command, and `--dev` means "restart on change" in fsdev, a different thing | both |

- **Because:** `--dev` is fsdev's restart mode for whoever edits the Lab. The people who run
  Shift Manager daily from this repository start it with `--dev`, so tying gaps to it shows
  them the clutter the issue removes. A setting is one checkbox and needs no server change.
- **Locks in:** the switch lives in `lib/coming.ts`. Tests and goal checks set the storage key
  `shift-manager:show-coming` before the page loads.
- **What would change my mind:** wanting gaps on for every viewer of one Lab (a demo). Then a
  served meta sets the same switch's default, and the setting still overrides it.

<a name="d2"></a>
## D2 · Ticket ids leave the visible copy; `data-gap` keeps them

- A line that is true today and ends with a ticket sentence splits into `text` (always drawn)
  and `coming` (drawn with the switch on). Example: Inbox says which asks it lists; "an
  organization-wide view is FIX-1652's call" is the `coming` half.
- **Every drawn gap carries its line in `data-gap`**, including the `coming` half when it's
  hidden, as the issue asks, so a test reads the owner without turning the switch on.
- **Locks in:** with the switch on, the screens read exactly as they do today.

## Decided, not asked

- **E1 · A route to a hidden tab opens Session** rather than an error or a redirect. The URL
  stays as typed; the selected tab is Session.
- **E2 · IN REVIEW is dropped only while it's empty.** If a status ever maps to it, its rows
  are drawn with the switch off.
- **E3 · The v2 look goal runs with the switch on.** It grades the design, which draws the
  placeholders.
- **E4 · COST stays a gap here.** FIX-2398 fills it (the epic's build order), so this issue
  doesn't touch harness usage reads.
- **E5 · A `patch` changeset.** `@flow-state-dev/shift-manager` is published and anyone who
  runs it sees the placeholders go, so its changelog says where the switch is.

## How it got here

- Drafted 2026-10-31 with the build prototyped beside it, to check both controls fail before
  the checks are proposed.
