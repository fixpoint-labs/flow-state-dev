# FIX-1785 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

One predecessor: the discovery door, [FIX-817](../FIX-817/).

| Prior anchor | Prior intent | Here |
|---|---|---|
| [FIX-817 Open-1](../FIX-817/DECISIONS.md#open-1) · one tool, `detail` defaulting to thin | A catalog stays cheap: an entry is id, kind and purpose; `contract` comes back only when asked | **Retained**, amended. `detail` and its default stay, and `contract` is still withheld from a short listing. Amended: an entry may carry `facts`, which no detail level withholds |
| [FIX-817 D2](../FIX-817/DECISIONS.md#d2) · projected on demand, never stored | A manifest is read from its domain's reader when asked | **Retained.** `facts` is projected the same way; nothing is stored |
| [FIX-817 D2](../FIX-817/DECISIONS.md#d2) · inventory rows are join keys, the entry carries purpose | Members and open time were treated as join keys and surfaced only in `contract` | **Amended.** The member list and the worker's kind are what an agent is asked about, so they move from `contract` into `facts` |

**Why.** #2768's 12-run log (FIX-1781): a model took the short listing and then invented the
member list. FIX-817's cost argument still holds for advice; it never meant to hide data.

**Compatibility.** Additive on the type (an optional field). The Workforce `contract` strings
change wording, which breaks only a reader that parsed them; the one known reader is #2768's
goal grader, moved to `facts` in this issue's PR (PLAN S8). Skills and resources entries are
unchanged.
