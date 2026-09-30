# FIX-1636 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

**No reader-facing documentation changes.** This issue proves what the epic's children shipped
and publishes nothing a user of the framework reads. The runner it adds is a CI script whose
header is its documentation.

**What it follows as written** (part 4), in an empty project on the installed tarballs:

| Page | Section | Published by |
|---|---|---|
| `apps/docs/docs/server/authentication.md` | "Ids you choose are addresses" | FIX-1018, with FIX-1022's session-id half |
| `apps/docs/docs/server/authentication.md` | "Addressed routes, and what they scope by" | FIX-1046's sentence |
| `apps/docs/docs/server/background-work.md` | The refusal table's `external-dispatcher` row | FIX-1634 |

`docs/architecture/state-and-scopes.md`'s request-id section is internal; part 4 reads it against
the behaviour, it does not follow it.

A page that breaks what it describes is a finding, fixed on its own route, never edited in the
closure PR. The keeping-a-flow-running guide's queue fence belongs to
[FIX-1656](https://linear.app/fixpoint-labs/issue/FIX-1656), which waits on this issue. The
epic's docs polish runs at wrap, after this issue closes.
