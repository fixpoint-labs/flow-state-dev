# spec(FIX-1366): teach the built-in worker kind

| A reader who… | Today | After |
|---|---|---|
| **wants a worker, no code** | First example says write a `kinds` map. Never learns there's a built-in | First example is the built-in. Same line says it has no memory, links the full reference |
| **needs their own tools** | Finds the built-in by luck. Reference lists 3 of 9 options | One click. All 9 |
| **needs something else** | Example kind `worker-agent` reads like the one that ships | Reads as an example: `custom-agent` |

Plus: a public Atlas page stops calling a removed API a pending decision.

**How:** grow and promote what exists. No new page. Rename one contract doc to the locked vocabulary.

## Sign off

1. **No new page. Grow the section, promote by anchor.** If wrong: one sidebar label fixes it.
2. **Reference lists all 9 options, emphasis unchanged.** If wrong: 3 classifier knobs are public surface we'd rather not have.
3. **Atlas: `workforce.html` only, 3 classes of false claim.** If wrong: 3 sibling pages stay wrong a while longer (FIX-1387).

**Open, recommend yes:** anchor-link only, no sidebar entry.

## Reviewers · look here

- **Why not a new page?** The spec's own first draft wanted one. Is anchor-link discoverability enough?
- **The 2 classifier tuning knobs.** Document, or defer in one line?
- **The Atlas stop rule.** 59 matching lines, 3 classes. Tight enough?

**Not here:** FIX-1387 · FIX-1362 · FIX-1364 · FIX-1386 · FIX-1393 · FIX-1392 (shipped).

[Spec](SPEC.md) · [Plan](PLAN.md) · Linear FIX-1366 · Epic FIX-1359 · never merges

<details>
<summary><b>How to review this</b> — altitude, what's in scope, what's deliberately unsettled</summary>

*(the spec-PR contract, pasted verbatim from `spec-template.md`)*

</details>
