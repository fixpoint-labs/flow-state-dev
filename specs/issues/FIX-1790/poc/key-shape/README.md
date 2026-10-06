# FIX-1790 · key-shape — can a per-org key name an old cell, or another user's?

**Question.** D1 adds no runtime guard against reading a cell an older release wrote. That is
safe only if no new key can ever equal an old one. And the new keys must stay injective for ids
carrying the delimiter, the escape, or the marker text itself.

**What it does.** Mirrors the engine's component escaping (`\` and `:` get a backslash) and builds:

- every legacy key: `<user>` and `<user>:<flow>`
- every proposed key: `<user>:~org:<org>` and `<user>:~org:<org>:<flow>`

over every id of length 1–3 from `a : \ ~ o`, plus `~org`, `~org:a` and `a:~org` (158 ids per
part). Any two different tuples sharing a key fail it. It also confirms the shared key equals
FIX-1538's owner-pinned cell for every (user, org).

**Run** (from the repo root, no install needed, about 20 seconds):

```bash
node specs/issues/FIX-1790/poc/key-shape/check.mjs           # PASS, exit 0
node specs/issues/FIX-1790/poc/key-shape/check.mjs --plant   # negative control: FAIL, exit 1
```

**What it showed (2026-10-06).** PASS: 25,122 legacy keys and 3,969,276 proposed keys, all
distinct; the shared key equals the pinned cell in 24,964 of 24,964 cases.

`--plant` drops the `~org` marker from the flow-isolated form (`<user>:<org>:<flow>`). It
FAILED with 24,964 collisions, the first being user `~org`, org `~org`, flow `~org` against the
shared key of user `~org`, org `~org`, and exited 1. The marker is what keeps the four-part form
apart.

**The premise held.** An old cell is unreachable by construction, so D1 needs no fallback guard
and no refusal path. Nothing in the design moved.

Retained design evidence, a sketch of the shapes and not the implementation. Not wired into CI
or any default discovery.
