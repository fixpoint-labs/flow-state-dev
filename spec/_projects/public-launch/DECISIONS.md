# Decisions — Public Launch

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Only calls that bind **more than one epic** go here. A call that binds one epic is that epic's.
PD-1 and PD-2 are owner locks Jake made with the FSD Architect on 2026-09-29, when FIX-1635 was
filed. PD-3 comes from the project's own Linear description ("this project is the launch
checklist"). None of them was decided in this document.

### PD-1 · Hard gates and the first hour are separate epics with separate outcomes

**Binds** FIX-1161, FIX-1635, and every later epic that claims part of the launch.

The first hour (FIX-1161) owns the stranger's path: scaffolding, `fsdev init`, the authoring pack,
and the publish plumbing it needs (FIX-1186, FIX-1162). The hard gates (FIX-1635) own defects that
would make a public release unsafe or broken. The two are parallel launch tracks and are related
only loosely. Rejected: nesting hard gates under the first hour, or under the finished kitchen-sink
support desk epic (FIX-1592).

**Costs** two epics that both touch "the published package works", which PR-1 splits by owner.
Accepted, because either outcome is testable only when it stands alone.

### PD-2 · A hard gate is a defect, not polish and not a product bet

**Binds** FIX-1635, the docs, brand and demo bar, and any later epic that labels work
launch-blocking.

An item blocks the launch when a stranger would be harmed by it or blocked by it: a cross-user
read or write, state lost silently, a published package that won't load, output dropped without
an error. Kitchen-sink polish (FIX-1631 to FIX-1633), parked escalations (FIX-1591), Ops repair
(FIX-1621) and the Tier B defect leftovers are not gates unless Jake adds them. Rejected: treating
anything visible at launch as a gate, which makes the list grow without an end.

**Costs** some visible rough edges will ship. Accepted. Those edges belong to the docs, brand and
demo bar, which has a quality bar but not a veto.

### PD-3 · Issues keep their own project homes, and the launch uses what has shipped by the cut

**Binds** every epic under this project.

A child nested under a launch epic stays in its own Linear project. Nesting shows which issues an
epic depends on. It does not move ownership. Feature projects (Memory, Workforce, orchestration)
ship on their own schedule, and the launch takes whatever has landed by the cut. Rejected: pulling
feature work into this project to make it launch-ready.

**Costs** a launch epic cannot speed up another project's issue by owning it. Accepted.

## Decided once

- **The launch is cut by readiness, not by a date.** The go-live question is whether the framework
  is actually ready, not what the calendar says. This comes from the project's original content.
- **Framework simplification ships first.** The launch ships the simplified surface. Where the must-finish
  line sits inside that project is still unanswered ([Plan](PLAN.md)).
- **Fixing a trust-boundary hole never reopens optional org.** Each auth child closes the hole
  it names under the principal-owned model (FIX-1442). This binds FIX-1635's children and any
  later epic that touches caller identity.

## Open

### Launch as 1.0, or as 0.x?

**Plain terms.** Launching as 1.0 tells everyone who installs FSD that we won't break their code
without a major version. A 0.x launch tells them the API can still change between minor versions,
and a careful team will pin their version. Our release tooling already assumes 0.x: pre-1.0
changes are released as patch or minor, and FIX-1192 exists because two changes asked for a major
bump.

**The trade-off.** 1.0 is the stronger promise to early adopters and reads better in a launch
post. It also makes every public API shape a launch gate, which widens FIX-1635 from known defects
to a full API review before the doors open. With 0.x the launch comes sooner and the gate list
stays as it is, but some teams will wait for 1.0 before they build on it.

**My recommendation.** Launch as 0.x, say so plainly in the announcement, and make 1.0 its own
milestone after the first cohort has used the API. Hard gates can then stay a defect list (PD-2).

**What would change my mind.** A design partner or a launch surface (a YC application, an
enterprise pilot) that needs a stability promise on day one.

**What being wrong costs.** It's reversible in one direction only. Going 0.x to 1.0 later is
cheap. Launching 1.0 and then breaking an API costs trust with exactly the people we launched to.
It also sets FIX-1635's scope before its objective gate, so it's worth deciding before that gate.
