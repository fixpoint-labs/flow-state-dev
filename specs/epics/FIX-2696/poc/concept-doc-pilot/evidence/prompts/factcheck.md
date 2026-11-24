You are fact-checking one documentation page for Flow State against this repository (a read-only copy with no git history). The page is at the end of this message, between the markers. Do not look for other versions of it. Do not edit anything.

List every factual claim the page makes about the framework: behaviour, defaults, limits, API names, option and method names, import paths, file layouts, what a package or kit provides, and what the code examples assume (imports, option names, call shapes). A claim about "today's code" is checked against today's code. Skip opinions, recommendations, open decisions and naming proposals; they are not claims.

Give each claim one verdict:
- RIGHT: supported by the code in `packages/` (cite file:line), or, for surface planned for the kits release (workforce, harnesses and Claude Code as kits, slots, `createFlowState({ kits })`, views), by the kits specs: `specs/epics/FIX-2618/` and `specs/issues/FIX-2619` to `specs/issues/FIX-2629`.
- WRONG: contradicted by the code or by those specs (cite the evidence).
- UNSUPPORTED: you looked and found nothing either way.

Be thorough and even-handed: check every claim the same way, however long the page is. Keep each claim to one line.

Output, in this order:
1. A table of every WRONG claim: the claim quoted short, why it is wrong, evidence.
2. A table of every UNSUPPORTED claim: the claim, where you looked.
3. A count of RIGHT claims (no need to list them all; list ten representative ones with evidence).
4. As the very last line, exactly: `TOTALS right=<n> wrong=<n> unsupported=<n>`

=== PAGE START ===
