# Rules — Public Launch

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

What every epic under this project obeys. Each rule has **exactly one owner**. The owner is the
epic that implements and proves the rule. Every other epic inherits it.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When a public package is published, a clean install of it imports under Node with no workspace present, and a package that ships built assets (devtool) ships them | FIX-1635 | FIX-1431's and FIX-1334's acceptance checks, and the closure run FIX-1636 (pack every package, install into an empty project, import each). FIX-1161's scaffold check inherits it: a stranger's first install is the same install |

PR-1 binds two epics because the first-hour scaffold installs from npm, so any package hard gates
leaves unloadable breaks the first hour too. Hard gates owns the fix. The first hour owns only
proving its own path on top of it.

**No epic may** label something launch-blocking that PD-2 excludes, or pull an issue out of its
own project to make it a launch child (PD-3).
