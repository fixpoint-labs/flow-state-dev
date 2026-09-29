# Plan — Public Launch

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

This file covers order, not how anything gets built. It says which order the epics run in, what
each hands the next, and what is deliberately not next. Each epic's own plan owns its checks.

## The arc — as of 2026-09-29

![The arc from August to November 2026. The first hour has an open in-flight bar from Aug 20 to the now line on Sep 29. Hard gates has a lane marked filed Sep 29 and no bar. The docs, brand and demo bar and the launch cut have empty dashed lanes.](figures/arc.svg)

The first hour is the only bar, and it has been open for six weeks. Hard gates starts when its
objective is approved. Nothing gets a bar until then.

| Epic | Consumes | Releases |
|---|---|---|
| **first hour** · FIX-1161 | Packages that import from npm (PR-1). The npm names and release credential its own children claim (FIX-1162, FIX-1186) | `fsdev init`, the scaffolding command, and the consumer authoring pack. That is the stranger's install path the launch cut announces |
| **hard gates** · FIX-1635 | The principal-owned identity model (FIX-1442). The BullMQ host as it stands, for the seed child FIX-1634 | No open launch-blocking defect, and published packages that load (PR-1) |
| **docs, brand and demo bar** · *not filed* | The docs the first hour writes for its own commands | FIX-550 docs sweep, FIX-551 brand pass, FIX-601 docs IA. One story across site, READMEs and demo |
| **the launch cut** · *not filed* | All three above, plus the surface framework simplification ships | FIX-1187 the attended first publish, FIX-1192 the changeset repair, the go-live and the announcement |

**Issues in the project with no epic.** FIX-1187, FIX-1192, FIX-550, FIX-551 and FIX-601 are
assigned to placeholders above. FIX-1188, FIX-1189, FIX-1190, FIX-1196 and FIX-1280 are individual
defects that aren't hard gates under PD-2 unless Jake adds them. FIX-360, FIX-420, FIX-489 and
FIX-214 are the original content's demo polish and testing items. They wait for the docs, brand
and demo bar or the launch cut to claim them.

## What is deliberately not next

- **The launch cut.** It is filed only once hard gates and the first hour are both close to done.
  That is also when the launch surface (HN, X, a YC application) and the framework simplification
  cut line get asked. Both were open questions in the project's original content, and no epic
needs either answer yet.
- **A second starter template.** One scaffold first. A menu of starters is FIX-548's follow-up if
  the single starter turns out to limit adoption.
- **An L2 Workforce child for FIX-1634.** It is filed once the L1 shape lands.
- **The Tier B defect leftovers** (the FIX-1002 family and similar). They aren't nested unless
  Jake expands hard gates.
