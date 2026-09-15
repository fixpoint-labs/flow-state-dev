# spec(FIX-1366): teach the built-in worker kind

**The built-in worker is documented, but the front door never mentions it, the example kind reads like a shipped default, and the reference lists 3 of 9 options.** A public Atlas page also calls a removed API a pending decision.

**Goal:** a reader meets the built-in on the first example, learns its limits in the same breath, and reaches a complete reference in one click. No second copy.

## What you're signing

| | Decision | Instead of | Locks in |
|---|---|---|---|
| **D1** | No new page. Grow the section, promote by anchor | New page · redirect stub | No sidebar entry. A label fixes it later |
| **D2** | Reference lists all 9 options, emphasis unchanged | "3 + a switch" · or list 3, defer 2 in a line | 3 classifier knobs become public surface |
| **D3** | Atlas: `workforce.html` only, 3 classes | Restructure · sweep all 4 | Siblings stay wrong until FIX-1387 |

**One open call → recommend yes.** Anchor-link promotion only. Cost if wrong: one sidebar label.

## What the pages will satisfy

R1 first example answers "no code?" · R2 no-memory on the front door · R3 all 9 options · R4 classifier not promoted · R5 `tools:` fence + hole · R6 no `worker-agent` · R7 no issue numbers · R8 builds clean · R9 no pending-decision framing on removed API · R10 contract named by locked vocabulary. Each maps to a decision, a surface, and a check in the [plan](PLAN.md).

## Reviewers · look here

- **D1** — is an anchor link enough? Sidebar-only readers never see the concept named.
- **D2 / R4** — the 2 classifier tuning knobs: document, or defer in one line?
- **Plan S4** — 59 matching lines. Is the 3-class stop rule tight enough?

**Not here:** FIX-1387 · FIX-1362 · FIX-1364 · FIX-1386 · FIX-1393 · FIX-1392 (shipped).

[Spec](SPEC.md) · [Plan](PLAN.md) · [Explainer](EXPLAINER.md) · Linear FIX-1366 · Epic FIX-1359 · never merges

<details>
<summary><b>How to review this</b> — altitude, what's in scope, what's deliberately unsettled</summary>

*(the spec-PR contract, pasted verbatim from `spec-template.md`)*

</details>
