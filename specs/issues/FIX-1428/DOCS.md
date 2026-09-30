# FIX-1428 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

No site page changes: no behaviour a framework user sees changes, and the new helper is a small
utility, not a concept. Two package READMEs list the helpers subpath and gain one entry each.

## UPDATE · `packages/contracts/README.md` · "Pure helpers" bullet

Append `isWindowsReservedName` to the list of helpers in the bullet, so it reads:

> - **Pure helpers** (`@flow-state-dev/contracts/helpers`) — `deepEqual` / `looseDeepEqual`,
>   `mapLimit`, `toError`, `camelToKebab`, `normalizeTagName`, and `isWindowsReservedName`.
>   Re-exported from `@flow-state-dev/core/helpers`.

(Keep the bullet's existing wording and order; only the new name is added.)

## UPDATE · `packages/core/README.md` · "Helpers (`@flow-state-dev/core/helpers`)"

Add `isWindowsReservedName` to the note listing contracts-owned helpers, and one bullet after
`toError`:

> - **`isWindowsReservedName(name)`** — `true` when `name` is a name Windows reserves for a
>   device: `con`, `prn`, `aux`, `nul`, `com1`–`com9` or `lpt1`–`lpt9`, in any letter case.
>   It matches the whole name, so pass a file's basename without its extension; Windows refuses
>   `con.txt` as firmly as `con`. `com0` and `lpt0` are ordinary names and return `false`. Use
>   it wherever a user-supplied name becomes a file or folder, so a repository written on macOS
>   or Linux still checks out on Windows.

## Publication ownership

FIX-1428 publishes both lines in its implementation PR, after the checks in
[PLAN](PLAN.md#checks) pass.
