# baseline · FIX-2769 POC

Retained spec evidence, not production code. Excluded from production discovery: it is a
plain `.mts` script, not a `*.test.*` file, and no workspace's test glob reaches `specs/`.

**The question.** What do claude-code-style's inventory rules find in Teammates and Shift
Manager today, with each app's own entry and type scope, keyed as the allowlist keys them?

**Run:** `node specs/issues/FIX-2769/poc/baseline/count.mts` (add `--keys` to print every key)

**What it showed (2026-11-17, `origin/main` at `d32d608512`).** The numbers in
[DECISIONS.md → Settled](../../DECISIONS.md#settled). Teammates has keys that repeat, so the
allowlist is a multiset. Claude Code-style's type list hides two of Teammates' types by file
name, so each app needs its own list.
