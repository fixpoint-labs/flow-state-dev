# FIX-1503 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to
build any piece. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![Lanes against time, with a now line at 22 September 2026. An input lane from FIX-1442 is done. Three unfiled lanes follow: mint plus verified default, then consumer cutover, then the CyberForce proof. FIX-906 leftover sits after the engine lane. No child carries a live bar.](figures/path.svg)

Nothing in the set has started. The now line is spec authoring. Only the engine child can
start at the gate. Cutover needs a mint to call. The proof waits on callers that mint. The
dependency graph is in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this figure
adds time.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-XXX** mint + verified default | spec → impl PR | Today's verify helpers · FIX-1442 principal→org · [D2](DECISIONS.md#d2) [D3](DECISIONS.md#d3) | Mint route · verified-by-default · closed `list_flows` / `capabilities` · named escape · architecture + mint docs | Cutover · FIX-906 | Medium |
| **FIX-XXX** consumer + test cutover | spec → impl PR | The mint · [ER-5](BUSINESS-RULES.md) | Kitchen-sink, Devtool, docs examples, MCP / scheduled / voice / BullMQ, HTTP `goals/` and labs (including conductor and fsd-coding-skill), integration-tests' HTTP faces presenting Bearer | The proof (with leftover) | Large · the expensive part |
| **FIX-XXX** CyberForce proof · required | spec → goal check | Mint · cutover · leftover reads | One real Lab call on the real path, asserted pass and 401 | The epic's wrap | Small |
| **FIX-906** thin leftover | spec → impl PR | The mint · [ER-7](BUSINESS-RULES.md) | Principal on session/resource/read + `transcribe` · Next and `fsdev serve` parity | The proof (with cutover) | Medium |

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-22) is the review-time snapshot. Follow its
Linear links for current status.

The one input from another epic: [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442)
is Done (spec [#1899](https://github.com/fixpoint-labs/flow-state-dev/pull/1899), impl
[#1985](https://github.com/fixpoint-labs/flow-state-dev/pull/1985)). [ER-12](BUSINESS-RULES.md)
consumes it without re-parenting it.

Open PRs that touch the same files, verified 2026-09-22: [#1223](https://github.com/fixpoint-labs/flow-state-dev/pull/1223)
(tenant binding on request routes) and [#2027](https://github.com/fixpoint-labs/flow-state-dev/pull/2027)
(unauthenticated org-binding test). Neither owns mint or the default flip; the engine child
reconciles, it does not wait.

## What unblocks what, from here

1. **This epic-spec is approved and merged** → the three gaps are filed and may be specced.
   FIX-906 stays Backlog until mint exists.
2. **The engine child merges** → cutover can mint; FIX-906 can consume the same principal;
   [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) becomes enforceable (not started
   by this epic).
3. **Cutover and FIX-906 merge** → the proof is filed and can run.
4. **The proof's goal check passes** → wrap: lessons, docs polish, completion in Linear.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The default flip vs callers | Engine and cutover | Engine ships mint and the escape in the same change as the default. Cutover must not be asked to survive a day with neither |
| `list_flows` payload | Engine and FIX-1486 | Engine gates the route. It does not add org fields or kinds-per-principal ([D2](DECISIONS.md#d2)) |
| `transcribe` | Engine and FIX-906 | Engine must not add a second gate. Leftover makes the handler read `ctx.principal` |
| Docs authentication page | Engine and cutover | Engine publishes the mint page and rewrites the default. Cutover updates examples; the second writer links |
| Devtool bearer | Cutover and node/`fsdev dev` | Loopback injection may mint or pass a minted token. It is not a second secret CyberForce cannot use ([ER-14](BUSINESS-RULES.md)) |

## Not children, deliberately

[FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) (Done) ·
[FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) (listing types) ·
[FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477) (UI packaging) ·
[FIX-23](https://linear.app/fixpoint-labs/issue/FIX-23) (resolver contract, Done).
Linked from the rules, never re-parented.

## Docs

Docs change is required: the public default flips and a mint appears. Shared narrative and
publication ownership: [DOCS.md](DOCS.md). Engine publishes the hub and the mint page.
Cutover publishes examples. Architecture `docs/architecture/authentication.md` updates with
the engine child.

## Guardrails

- **Convergence on mint trust.** Every writer that issues or accepts a principal goes through
  the host-proof mint or an explicit branded escape. Legacy helpers that read `body.userId`
  while a real resolver is configured are the defect ([ER-9](BUSINESS-RULES.md)).
- **BP-030 on the default flip.** Dual-read the escape; do not delete `defaultBodyUserIdPrincipalResolver`
  in the engine child.
- **BP-031.** Auth decisions from the verified principal, never body, query, or spoofable headers.
- **No changeset on this spec PR.** Direction only.

## Sketch

None. The composition is the existing verify helpers plus one issue/sign sibling, not a
novel block graph.

## POC

`poc/consumer-corpus/` re-derives the named HTTP-cutover list (totality + `--plant`
negative control). Not an end-state composition POC.

## At implement time

Issue-specs own mint path spelling, claim-name extras, and the escape flag's exact letters.
They do not reopen [Settled](DECISIONS.md#settled), [D2](DECISIONS.md#d2), or [D3](DECISIONS.md#d3).

## Follow-ups

- FIX-1486 inventory types, once identity is verified.
- FIX-1477 rail-seat decision, once `list_flows` is no longer open.
- Bind-guard false positive on host-level `createFlowState({ resolvePrincipal })` — deepening,
  not this epic, unless the engine child touches that file.

## Wrap

When [ER-21](BUSINESS-RULES.md) holds: lessons pass, docs polish over the authentication
pages, completion from Linear and implementation evidence. Amendments through a follow-up
PR, not a final status commit.
