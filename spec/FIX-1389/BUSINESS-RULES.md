# FIX-1389 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

On a refactor most rules are *this does not change*, and saying so is the point: below is the
contract the four readers already have, so the move can be checked against it. One rule changes,
and it is marked.

## The shared walk, once the extract lands

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | The configured root is a symlink | **Changed for two readers.** Every reader throws `Symlinked workforce directory "<root>" — refused for safety`. The channels and resources readers do today; the worker and skills readers follow the link | CI · new case per reader — **red first** for the worker and skills readers; green for the two that already refuse |
| BR-2 | The root cannot be read at all | Every reader throws `Failed to read workforce directory "<root>": …`, as today | Existing suites |
| BR-3 | The root exists and holds no `teams/` | **The team traversal** yields and reports nothing, as today — but only the worker and channels readers end up empty. The resources reader still returns its `org/resources` documents, the skills reader its `org/skills` level; neither is inside the traversal | Existing suites |
| BR-4 | `teams/` is a symlink or exists and cannot be listed | One failure under the path `teams`, in that reader's own wording and condition, as today | Existing suites |
| BR-5 | A team folder is a symlink | One failure under `teams/<id>`: `Symlinked team folder "<id>" — refused for safety`. The other teams still load | CI · **new case** each for channels and resources, green on today's code |
| BR-6 | A team folder exists and cannot be read | One failure under `teams/<id>`: `Team folder "<id>" could not be read: …`. The other teams still load | CI · **new case** each for channels and resources, green on today's code |
| BR-7 | Something in `teams/` is not a directory | Skipped in silence — it occupies no team slot | Existing suites |
| BR-8 | An entry at any enumerated level is `.DS_Store` or `Thumbs.db` | Skipped before it is read as a name, from one list rather than three | CI |
| BR-9 | Any reader reports any failure | The entry carries `path` and `kind`, from that reader's closed union: a refused structural folder, a slot that would not load, a refused declaration. **New for the worker reader**, whose entries carry none today; unchanged for the others | CI · type-level and runtime |

BR-5 and BR-6 are the reason this page exists — see *How parity is actually proved*.

## What each reader keeps to itself

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | A file sits in a `workers/` or `channels/` slot | Skipped in silence. A seat and a channel are folders | Existing suites |
| BR-11 | A directory sits in a `resources/` slot | Reported as `folder-where-file-belongs`, naming the file to write instead. The deliberate inversion of BR-10 | Existing suites |
| BR-12 | A declaration file declares a key its convention derives or refuses | That convention's own refusal, with its own message and its own condition | Existing suites |
| BR-13 | The skills reader runs | Its three-level list, its ancestor-symlink reporting and its duplicate-name refusal are untouched. It consumes the shared root open and nothing else | Existing suites |
| BR-14 | The channels reader runs | It walks `teams/` only. The shared enumerator gives it no `org/` scope and does not invite one | CI · a planted org channel is still invisible |
| BR-15 | `readSkillsDirectory` in `orchestration` runs | Unchanged, including its own ignore list, its `ignore` option, and its unguarded root — still [FIX-1375](https://linear.app/fixpoint-labs/issue/FIX-1375)'s to fix | Existing suites |

## The boundary the extract must not cross

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | The extract is complete | No reader in the package holds a second ignore list, a second `readdir` of the root, or a second `teams/` loop | CI · grep, executed |
| BR-17 | A convention wants behaviour the shared piece does not have | It writes that behaviour in its own leaf loop. The shared piece grows no per-convention parameter | Review · [D1](DECISIONS.md#d1) |
| BR-18 | Anything is exported | It leaves the package through the `./loader` subpath only, and nothing new reaches the package root | CI · typecheck against the export map |

## How parity is actually proved

"The existing tests still pass" proves a pure move **only if those tests reach the code being
moved**, so that was measured, not assumed, on a clean tree at 272 passing tests:

- **The already-shared lower half is covered.** Folding the symlink refusal out of the shared
  structural open fails **6 tests across all four reader suites**.
- **The team walk is not.** Removing the team-folder reporting from all three readers at once
  fails **exactly one test**, in the worker suite. The channels and resources suites have no case
  for a bad team folder at all.

So the extract cannot lean on the suite as it stands. **But what is missing is coverage, not
behaviour, so the red does not live in the new tests.** Both
readers already report a bad team folder under `teams/<id>` in BR-5 and BR-6's exact words —
verified by running them. A correct new case therefore passes on unmodified code; demanding red
would be asking for a behaviour change this spec forbids. **The mutation above is the red
instead:** once BR-5 and BR-6 exist it must fail three suites rather than one, and fewer means a
case passes beside the extracted enumerator rather than through it.

## Failure taxonomy

Nothing retries and nothing degrades. A bad root is fatal and thrown, at boot, by every reader —
BR-1 and BR-2, the only fatal class. Everything below it is collected into that reader's own
`errors`, and whether a non-empty `errors` stops the app stays the caller's explicit call, as
today.

## Acceptance criteria this issue owns

For the same tree, each of the four readers produces the records and failures it produces today —
same order, same paths, same message text — with one exception: a symlinked root, which all four
now refuse. And the package holds one team walk, one root open, one ignore list.
