# FIX-1480 · Documentation intent

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

**Explore / not-ship.** No published page changes in this PR. What follows is what SHIP-A's implementation PR would hand `docs-writer`, then `docs-editor`. Do not draft the sentences here — the writer has not read this spec, which is the point.

## Destinations, after a ship

| Destination | Operation | What the reader must learn |
|---|---|---|
| `packages/workforce/README.md` | UPDATE · next to `createWorkforceCapability` and `hireWorkforce` | There is a factory a **worker kind** installs when some of its seats should be able to hire. Installing it is not granting it: a seat still names `hire` in `tools:`. The tool mints a seat of a kind the app already registered, writes the durable roster, and registers the address. It does not invent a kind |
| Workforce user docs (existing hire / inventory pages, not a new noun page) | UPDATE | A manager expands the team by hiring a seat of an existing kind. Teammates find that seat the same way they find file-declared ones if [D1](DECISIONS.md#d1) shipped. Fire removes it from the roster. Empty `tools:` still means no hire |
| Channel-admin docs, if any exist by then | CROSS-LINK only | Hiring a seat is not opening a channel |

## Voice traps

- Do not say "we used to only hire from files." Outsider rule.
- Do not mention FIX-1480, W4, Door B, or Role.
- Do not document `reconfig`, pools, or auto-scale.
- Do not imply every seat can hire.

## Not a destination

Kitchen-sink's admin hire README remains the host path. SHIP-C may add one manager file as a teach path; that is an example, not the API.
