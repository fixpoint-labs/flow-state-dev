# spec(FIX-1362): per-seat skills in the built-in worker kind

| Someone who… | Today | After |
|---|---|---|
| **drops a skill folder beside a worker** | Nothing happens | That worker holds it. Nobody else. `/name` uses it |
| **gives two workers different skills** | Both read one org-wide bucket | Each has its own drawer |
| **wants a skill in every prompt** | Can't say so | One line in the worker file |
| **fixes a typo in a company skill** | Everyone sees it | Running workers keep their copy until refreshed |
| **runs a turn with no skill** | Free | Still free |

The contract already promises *a seat's skills are that seat's*. The built-in kind shipped days ago; this is the next thing a roster reaches for.

**How:** the loader's per-seat union rides the worker record and arrives at hire as a setting, the way a body arrives as instructions. The kind reads it from config, the only per-seat channel a block has. No new primitive.

## Sign off

1. **A skill beside a worker is reachable, not always-on.** If wrong: the first thing people try looks broken.
2. **A seat holds a copy. Refresh is deliberate and replaces the folder whole.** If wrong: withdrawn instructions stay live, or a refresh destroys edits someone expected to keep.
3. **Skills ride the worker record, fixed at roster read.** If wrong: the kind's wiring is a rewrite.

**Open: none.** Number 1 is the one to weigh: a promise over the thing people try first.

## Reviewers · look here

- **Why not always-on?** Is "drop a folder, type `/name`" a good enough first experience?
- **The settings bag as the only per-seat channel.** Wrong layer = rewrite.
- **The fence.** A seat's own skill can now declare `agents:`. Check where it's closed.
- **Unsure:** refresh destroying local edits on an "update".

**Not here:** FIX-1390 · classifier · keyword tier · FIX-1364 · FIX-1366.

[Spec](SPEC.md) · [Plan](PLAN.md) · Linear FIX-1362 · Epic FIX-1359 · builds on #1754 · never merges

<details>
<summary><b>How to review this</b> — altitude, what's in scope, what's deliberately unsettled</summary>

*(the spec-PR contract, pasted verbatim from `spec-template.md`)*

</details>
