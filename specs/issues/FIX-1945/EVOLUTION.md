# FIX-1945 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1793 D3: a workstream's standing instructions are appended, never in place of the base; "a skill the coordinator writes for one session is a follow-up". Source: [`../FIX-1793/DECISIONS.md#d3`](../FIX-1793/DECISIONS.md#d3) | **Amended in part.** "Appended, never in place of" is retained. The deferred worker-written entry now exists, but per worker and per person, not per session | Jake asked for notes that last across sessions ([FIX-1945](https://linear.app/fixpoint-labs/issue/FIX-1945)); a per-session skill would not | [D1](DECISIONS.md#d1), [D2](DECISIONS.md#d2); BR-6 | Workers without rules behave as today (BR-7). A per-workstream skill is still a follow-up |
| FIX-1788 D8: long-term memory is the user's, shared by their workers; nothing in memory is keyed by worker. Source: [`../FIX-1788/DECISIONS.md#d8`](../FIX-1788/DECISIONS.md#d8) | **Retained** | Rules are not memory; they live in a per-worker record keyed like the skills drawer | [D1](DECISIONS.md#d1) | Memory unchanged |
| FIX-1788 BR-3: a standard worker cannot be written, edited or deleted by any path. Source: [`../FIX-1788/BUSINESS-RULES.md`](../FIX-1788/BUSINESS-RULES.md) | **Retained** | A rule is the person's record beside the worker, not an edit of the worker | BR-9, BR-11 | Standard workers stay read-only |
| Arch C3: a worker's skills drawer is per worker (per user through its user scope, FIX-1788 D6); a file the source never had is the holder's own edit and survives a refresh. Source: [`workforce-default-worker-flow.md` C3](../../../docs/architecture/workforce-default-worker-flow.md#c3--a-workers-skills-are-stored-per-worker-and-stored-is-not-the-same-as-filled) | **Retained** | The rules record copies the drawer's keying; the drawer itself is unchanged and holds no rules | S1, BR-13 | Seeded skills unchanged |
| FIX-1786 concept, "Memory" table: a "Worker" layer, "how this worker operates, across all its sessions". Source: [`../../epics/FIX-1786/concept/CONCEPT.md`](../../epics/FIX-1786/concept/CONCEPT.md) | **Not built here** | Standing rules cover part of that need without a memory layer; ER-15 forbids documenting a layer no flow keeps | D1; DOCS says rules aren't memory | The memory layer stays FIX-1775's later work |

FIX-1776 (the coordinator's memory pack) is a neighbour, not a predecessor: it has no retained
spec, and nothing here changes it.
