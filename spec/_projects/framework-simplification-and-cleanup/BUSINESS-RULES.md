# Rules — Framework simplification & cleanup

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

What every epic under this project obeys. Each rule has **exactly one owner**, the epic that
implements and proves it; the others inherit it. A rule with two owners is a seam; a rule with none
is a wish.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When an epic's docs show how a host is mounted or called over HTTP, then they teach a verified caller; a caller-typed `userId` appears only as the named local-development escape, never as a shipped mode | FIX-1503 | FIX-1503's consumer cutover, over every docs example it names; FIX-1637's own docs review for any page it adds |

**PR-1 is FIX-1503's ER-10, raised to this altitude** because a sibling now writes the pages it
governs: FIX-1637's config matrix covers the host mount for webhooks, cron and event ingress.
Whichever lands second reads the other's pages ([Plan](PLAN.md) → seams). The repo-wide grounding,
including BP-031 on caller input, binds every epic already and is not restated here.

**No epic may:**

- **Collapse a block kind or a state scope, or deprecate scope state.** Decided once, twice
  ([Decisions](DECISIONS.md) → 1, 2).
- **Merge the two durable-storage primitives**, or re-derive the rejected splits by scope range or
  by persistence (→ 3).
- **Remove capabilities, skills, tools, `ui` or thought-fabric**, or cut the sequencer's public
  surface (→ 4, 5).
- **Make client data visible by default** (→ 6).
- **Add a capability under this project's name.** A cleanup that needs a new feature files it
  where features live; this is the fence in the [territory](SPEC.md).
