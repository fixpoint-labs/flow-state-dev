# FIX-1455 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

At epic altitude the rules are not behaviours of one feature; they are the constraints every
child spec and implementation must satisfy, and the place a cross-spec review checks. Each says
who owns it and where it is checked.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | A request to a file-declared seat (`support.ada`) is answered over kitchen-sink's real HTTP route, against the Next-built app, with the desk that seat's own `WORKER.md` declared | FIX-1429 | The `code-comes-from-files-alone` goal check |
| ER-2 | Hire a team, open a channel, create a board; redeploy; all three are still there, served from the Postgres path the app already uses | FIX-1475 ([D2](DECISIONS.md#d2)) | FIX-1475's goal check · the epic's proof |
| ER-3 | One channel family, one named instance of it, and a seat that drains a named subset of that instance's boards. A minted board with no declaring seat warns | FIX-1476 ([D4](DECISIONS.md#d4)) | FIX-1476's tests · the warning is visible in the run |
| ER-4 | Every component the rebuilt shell renders is imported from a client package. Kitchen-sink adds no component the packages could not export | FIX-1477 ([D5](DECISIONS.md#d5)) | FIX-1477's spec review · the app's import graph |
| ER-5 | One recipe per job on screen. A surface that keeps `@flow-state-dev/patterns` carries a written *keep because…* in its PR | FIX-1478 ([D6](DECISIONS.md#d6)) | FIX-1478's PR |
| ER-6 | The words on screen and in files are Seat, Kind and Agent, as [D3](DECISIONS.md#d3) defines them — not worker, bot, team member or agent-as-session | FIX-1476 defines · every row consumes | Every child's spec review |
| ER-7 | Every region of the rebuilt shell is either inline or resource-backed and says which. The rail is org → channels → seats; the right panel is boards and roster and is not conditional on a mode; under narrow width boards yield first, the rail second, the stream never | FIX-1477 builds · [D7](DECISIONS.md#d7) decides | FIX-1477's spec review · FIX-1475's and FIX-1476's, against the figures |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-8 | No kitchen-sink-only durable store, and no roster that lives only in process memory | [D2](DECISIONS.md#d2). A fifth persistence layer taught by the reference app |
| ER-9 | No kitchen-sink-only UI API, and no third Workforce UI package beside `react` / `client` | [D5](DECISIONS.md#d5). A shape that cannot be exported is a finding, not a workaround |
| ER-10 | No hired seat inside `supervisor()` or any pattern factory | [D6](DECISIONS.md#d6). It collapses the roster the epic exists to show |
| ER-11 | No Agent, Team, Channel or Board minted as a Layer 1 type | [D3](DECISIONS.md#d3). Workforce is L2 on orchestration |
| ER-12 | No ambient "all boards" seat drain, and no widget that renders one | [D4](DECISIONS.md#d4). Board v1 is explicit per-seat wiring |
| ER-13 | No nested or child sessions as the work control plane | Tasks and boards nest work; sessions link via hire and assign. `parentSessionId` is not a control plane |
| ER-14 | No second skill registry and no second memory story for kitchen-sink | Cohesion. The app consumes what the packages ship |
| ER-15 | No Lab product inside kitchen-sink. DevForce and CyberForce run beside it | Epic body invent-kill. They are finish-line Labs; this teaches the conventions |
| ER-16 | No runtime channel-admin verbs (create / delete / invite) | FIX-1415's, parked and adjacent. This set is the declarative convention |
| ER-17 | No child re-parents FIX-1415, FIX-1430, FIX-1442, FIX-1351 or FIX-1407 under this epic | Consumed, not owned |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-18 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear; a stale child blocks its dependants whatever its PRs say |
| ER-19 | A cross-cutting question a child hits is commented **up** on the epic PR, not decided locally | [DECISIONS.md](DECISIONS.md) is the single place. A local answer is a second authority |
| ER-20 | FIX-1429 is the only direct-route row. Every other row reads *spec* and keeps its approval gate; the route is re-derived from the Linear category label, never stored | Fail-closed routing ([orchestration.md](../../../docs/contributing/orchestration.md) → "Which issues get a spec") |
| ER-21 | The set is open. A child filed later gets a row, a lane, a column in the ownership matrix, and inherits every rule here | Filing one is normal course, not a re-scope |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| ER-22 | A clone of kitchen-sink hires a team, opens a channel with boards, is redeployed, and still has all of it — with a seat draining its named subset and the unattended board warning visible | FIX-1475's goal check on the real path, plus FIX-1476's |
| ER-23 | `goals/workforce-conventions/code-comes-from-files-alone/goal.md` moves off `NOT RUN` | That goal's own contract, over the real HTTP route against the Next-built app |
| ER-24 | The rebuilt shell's components are imported from client packages by an app outside kitchen-sink, or the import surface is demonstrably able to be | FIX-1477's PR — the export list, and one consumer that is not the reference app |
| ER-25 | The docs teach hire, channels and boards as what a Workforce app *is*, not as a kitchen-sink recipe | The wrap's docs-polish pass over the Workforce pages the children each edited in isolation |
