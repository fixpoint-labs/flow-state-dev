# Process: what-flow-state-is

## Cold read 1
Fresh tool-less `claude -p`, given only the doc. Asked for the parts in order (owner, where stored), nine scenarios and the terms it guessed. Scenarios: kit order, a stray `notes.txt` in `workforce/`, editing `coder`, a kit filling a slot of a kit it doesn't require, whose session is Bob's, five jobs mapped to layers, a duplicate harness id, starter vs kit.

Every scenario answer was right. Gaps it named:
- "Which one to change" is listed as a part but is a guide. Reworded the list item.
- It couldn't tell whether a duplicate slot key fails at build or start-up. Rule 6 now lists every build-time refusal.
- "Org" was undefined. Added a definition and a vocabulary row.
- "Review switched on" was vague. The scenario now names the `review` config.

## Cold read 2
New reader, different edge cases: sharing between Alice and Bob, a second kit wanting `workforce/`, a page testing for a kit, a kit upgrade versus edited `WORKER.md`, whether a worker is a flow, view ownership, a duplicate flow id.

All answered correctly except where the doc was silent:
- Who owns the roster view: added a row to the flows table.
- When a duplicate flow id is refused: added to rule 6 and the flows section.
- Where a second kit's files go: added a sentence under the folder rule.
- What happens to edited files on upgrade: it answered, but only after I had added that. The first draft never said scaffolded files don't update.

Stopped after two readers. I did not rerun after the last fixes, which were one sentence each.

## Bar check
Against the Workforce exemplar, part by part: base terms, ordered parts, per-part owner/seen/stored/how-many tables, a "what this replaces" note under kits, why-not subsections, one traced scenario with a diagram, naming debates, numbered rules, vocabulary plus counted retired terms, decisions with recommendations, and a gap table with paths. Thinner than the bar: no migration table (no file format changes in this topic), and the retired-term counts are approximate (a pattern search for `reads`).

## Limits
- The SVG was rendered in light mode and looked at. Dark mode and the two mermaid figures were not rendered.
- I couldn't `cd` to an empty directory, so both readers ran from the sandbox with its CLAUDE.md loaded. I told them to ignore it. None of their answers used anything outside the doc.
- A grep for "starter files" printed the path of a `docs/internal` file. I did not open it.
