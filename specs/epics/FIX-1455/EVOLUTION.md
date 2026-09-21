# FIX-1455 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

This set is written on top of four earlier decisions and changes three of them. None of the
four has a retained artifact under `specs/` — they predate the retention policy — so each is
cited through its real Linear or PR provenance rather than a local path
([retention policy](../../../docs/contributing/orchestration.md#spec-retention-and-authority)).
**Changes made to this set after it merged** are recorded in their own table below, against this
set's own merged text.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| **The epic body's channel lock:** *"`CHANNELS.md` = kind/family config under `workforce/flows/channels/<kind>/`… no `CHANNELS.md` in the instance tree"* — source [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455) description → *FSD Architect — EM fences (2026-09-19)* → **Channel / board locks** | **Superseded** | `CHANNELS.md` is not a shipped surface: zero occurrences anywhere on `origin/main` outside this spec tree. What shipped is a kind as TypeScript at `workforce/flows/channels/<kind>.ts` gathered by `fsdev gen`, and an instance as `CHANNEL.md`, published in [code-on-disk.md](../../../apps/docs/docs/workforce/code-on-disk.md) and [channels.md](../../../apps/docs/docs/workforce/channels.md). Ruled by the Architect on [PR #1978](https://github.com/fixpoint-labs/flow-state-dev/pull/1978#pullrequestreview-5261887818) | [D4](DECISIONS.md#d4), rewritten to the shipped pair. FIX-1476 owns it; every other row consumes it | A reference app teaching `CHANNELS.md` would fork the published tree. No migration: nothing was ever built on the old shape |
| **The epic body's board v1 lock:** boards are a bare name list in `CHANNEL.md` frontmatter, the framework mints a ledger per name, code wires drain only via `channelBoard` / `taskBoard`, unattended boards warn, one factory carries the kind clones — same source, same section | **Retained whole** | Settled upstream by [FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385) / [PR #1922](https://github.com/fixpoint-labs/flow-state-dev/pull/1922) and published in [channels.md](../../../apps/docs/docs/workforce/channels.md). The D4 rewrite above changes the *kind/instance* half only | [D4](DECISIONS.md#d4)'s board half, unchanged; [ER-3](BUSINESS-RULES.md) and [ER-12](BUSINESS-RULES.md) | None. **Changing one decision in a source does not supersede the rest of it** — this row exists so the D4 rewrite is not read as reopening board v1 |
| **The epic body's UI vocabulary:** *"**Inline UI** = request/stream-local (task progress chips, turn updates)"* — same source → **EM vocabulary / POC spines** | **Amended** | Wrong about the code: `Conversation` and `RequestGroupRenderer` render the full persisted `session.items`, `Approval` reconstructs a resolution from that same stream, and [streaming.md](../../../docs/architecture/streaming.md) makes most item types durable. Read as a lifetime, FIX-1477 would ship a channel that drops earlier turns and resolved approvals on reload | [D5](DECISIONS.md#d5): *inline* names the **source** a region reads — the session's item stream — against *resource-backed*, a standing collection. Both survive a reload | A technical correction. No issue gains or loses work and no owner moves; the two shapes and their package routing are unchanged |
| **W5's membership claim:** FIX-1455 ran *as a member of* the W5 set, with W5's ER-1/ER-2/ER-3 and its standing ship fence pointed at kitchen-sink — source [FIX-1457](https://linear.app/fixpoint-labs/issue/FIX-1457) and [PR #1944](https://github.com/fixpoint-labs/flow-state-dev/pull/1944) **D9**, which records kitchen-sink leaving the set and ER-15 being rewritten | **Superseded** (by the owner, 2026-09-20) | The owner's recalibration of FIX-1457 changed W5's identity to release QA and moved kitchen-sink out. FIX-1455 has no parent in Linear and sits under *Workforce: Layer 2 Abstraction*. Confirmed by the Architect on [PR #1978](https://github.com/fixpoint-labs/flow-state-dev/pull/1978#pullrequestreview-5261863715) | This epic's own objective and [D1](DECISIONS.md#d1)'s ship fence, which is **lifted** for this set | **The two epics read the fence differently and both are right.** #1944 records W5's fence as *standing* because FIX-1407 is In Review; D1 lifts it here on the same facts, for this set's gate. A child reads **its own** epic's card. [ER-17](BUSINESS-RULES.md) forbids re-parenting under W5 |

## Amended after the set merged

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| **[D7](DECISIONS.md#d7)'s rail contents:** *"The rail is org → channels → **seat list**"* — source this set's own `DECISIONS.md` as merged at [10d5eb9](https://github.com/fixpoint-labs/flow-state-dev/commit/10d5eb9b11155f1991574114a651c87c22581731) ([PR #1978](https://github.com/fixpoint-labs/flow-state-dev/pull/1978)) | **Extended** — not superseded | D7's *outcome* is untouched: the rail is still the workforce, the roster still has one home, and the yielding order is unchanged. What D7 did not say is how you get from a kind to an instance to a session inside it, and a flat seat list cannot say it. Left unstated, FIX-1476 and FIX-1477 would each have built half of a browser, differently | [D8](DECISIONS.md#d8): one navigator, depth read from the flow's declared `cardinality`. D7's *Locks in* is reworded to point at it; [ER-7](BUSINESS-RULES.md) carries it and [ER-9](BUSINESS-RULES.md) forbids a consumer-declared depth | **An extension is not a supersession, and a dependency is not either.** Nothing D7 decided is reversed and no owner moves — FIX-1477 still builds the regions, FIX-1476 and FIX-1475 still consume them. A child reading D7 alone gets a true but incomplete answer, which is why D7 links D8 rather than being rewritten around it |

## Predecessors this set consumes without superseding

- **The earlier own-project "Kitchen-sink / reference app" shell.** FIX-1455's description records
  it as superseded and archived-if-empty by the Architect and Cycle PM on 2026-09-19, before this
  spec existed. It carried no decisions this set re-opens; it is named here so a reader who finds
  the old project does not treat it as a second authority.
- **The W3 floor** ([FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351)) and **the W4
  first cut** ([FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407)). Consumed, not owned
  ([ER-17](BUSINESS-RULES.md)). **A dependency is not supersession**: nothing here amends either.
- **[FIX-1469](https://linear.app/fixpoint-labs/issue/FIX-1469)'s kitchen-sink half**, flagged
  stale on [PR #1944](https://github.com/fixpoint-labs/flow-state-dev/pull/1944) and routed to
  FIX-1455 rather than moved. It is not a child of this epic and this set does not re-file it.

Re-check every cited intention against current code and the architecture docs before
implementing. `docs/architecture/*` is the authority for how the system behaves now; the rows
above record what was decided, not what ships.
