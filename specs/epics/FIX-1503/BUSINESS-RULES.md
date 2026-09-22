# FIX-1503 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints every
child spec and implementation must satisfy. Each says who owns it and where it's checked.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | A reachable `/api/flows` deployment requires a verified principal on every route except mint | FIX-XXX engine | Engine tests · CyberForce |
| ER-2 | Mint is the sole unauthenticated HTTP route the engine adds | FIX-XXX engine | Engine route table · the corpus checker's HTTP face |
| ER-3 | `list_flows` and `capabilities` 401 without a principal and return the host-wide kind/capability list with one | FIX-XXX engine | Engine tests · [D2](DECISIONS.md#d2) |
| ER-4 | A minted JWT is HS256, lives fifteen minutes by default, and carries host-asserted `sub` and `org` | FIX-XXX engine | Engine tests · [D3](DECISIONS.md#d3) |
| ER-5 | Every named HTTP consumer presents a minted Bearer, or an explicit escape the node host still refuses to bind | FIX-XXX cutover | Cutover PR · consumer-corpus |
| ER-6 | CyberForce reaches a gated route with a minted token and is refused without one | FIX-XXX proof | The proof's goal check |
| ER-7 | Session, resource, and `transcribe` reads use the same principal; they do not invent a second plane | FIX-906 | FIX-906 tests |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-8 | No child builds login, an OAuth UI, a password store, or a user directory | Settled mint practice. FSD does not provide login |
| ER-9 | No child trusts `body.userId` or `body.orgId` when a real resolver or minted token is configured | BP-031 · FIX-1442 invent-kill |
| ER-10 | No child teaches optional / no-auth as a shipped mode for a reachable host | Local-dev escape only, named as such |
| ER-11 | No child invents kinds-per-principal or a third listing registry | [D2](DECISIONS.md#d2) · FIX-1486 |
| ER-12 | No child reopens FIX-1442's org cutover, reserved default org, or migration tool | Related, not owned |
| ER-13 | No child answers FIX-1477's packaging fork, or FIX-1486's type work | This epic dissolves openness pressure and enables the fence |
| ER-14 | No child ships a kitchen-sink-only or Devtool-only token CyberForce cannot present | One posture |
| ER-15 | No child dual-tracks a second "gate the surface" epic beside FIX-1503 | FIX-906 is leftover, not a peer |
| ER-16 | No child adds a second gate on `execute_action` or `create_session` | Those paths already 401 |
| ER-17 | No child hard-blocks W4 / W5 / kitchen-sink on this Backlog epic | Owner deferred scheduling; soft-align consumers when picked up |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-18 | A child's Linear state is mirrored when it changes | The wake derives blocked-by from Linear |
| ER-19 | A cross-cutting question comments up on the epic; after merge, amendments are a follow-up PR | Retained decisions are canonical |
| ER-20 | Every child's route reads *spec* by default | Fail-closed routing |
| ER-21 | The epic finishes only when CyberForce's goal check passes | [D1](DECISIONS.md#d1). Surface without proof does not move the lead measure |
| ER-22 | Placeholders read `FIX-XXX · working title` until filed; filing them is normal course, not a re-scope | The set is written before most issues exist |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| ER-23 | CyberForce, on the real path, mints a token, calls a gated `/api/flows` route, and is refused without one | The proof issue's goal check |
| ER-24 | Kitchen-sink and Devtool present that same minted Bearer, not a debug-only stand-in | Cutover's HTTP checks |
| ER-25 | The docs teach mint as token exchange, not as login | Engine child's docs PR, using [DOCS.md](DOCS.md) |
