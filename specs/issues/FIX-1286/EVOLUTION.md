# FIX-1286 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The Architect's call on FIX-1286, 2026-08-28 ([Linear comment](https://linear.app/fixpoint-labs/issue/FIX-1286)): option 1, bind adoption in the engine; "FIX-1286 closes when that engine binding lands; no separate bash-key change required" | **Retained** for the binding and for `run`'s meaning (no user key). **Amended** on "no bash-key change" | [POC](poc/workspace-outlives-record/README.md): the binding holds while a record exists and not after retention deletes it; the directory outlives the record | [D1](DECISIONS.md#d1): the key gains the request's start time, not the user | `run` still means one request, siblings share |
| Epic FIX-1635 [D3](../../epics/FIX-1635/DECISIONS.md#d3): FIX-1018 lands first, and "FIX-1286 may close as proved by FIX-1018, with its own test" | **Retained**: FIX-1018 first, and this issue consumes its binding. The "may close" branch is not taken, under D3's own *what would change my mind* | Same POC, the evicted leg | [D1](DECISIONS.md#d1) and [BR-2](BUSINESS-RULES.md#another-users-request-id) | The edge FIX-1018 → FIX-1286 stays: this implements after #2377 |
| The workspace scope identity rule (`packages/workspace/src/scope-identity.ts`, the `request` branch of `scopeComponents`): a request instance is `[tenant, requestId]` | **Amended**: the request instance is `[tenant, requestId, start time]`. `session`, `user`, `org` retained unchanged | No retained spec carries this rule; its provenance is the code and FIX-150's review (PR #1505) | [PLAN S3](PLAN.md#surfaces) | Run directories move once on upgrade ([BR-13](BUSINESS-RULES.md#what-does-not-move)) |

The epic's [DOCS.md](../../epics/FIX-1635/DOCS.md) listed FIX-1286 among the children that
publish nothing. That line is amended by [DOCS.md](DOCS.md) here; the epic's shared narrative
is untouched.
