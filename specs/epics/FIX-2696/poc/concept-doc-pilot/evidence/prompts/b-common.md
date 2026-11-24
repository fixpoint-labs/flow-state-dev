You are writing one concept doc for the flow-state-dev repository (this directory is a read-only copy of it; there is no git history and no node_modules). Run the `concept-doc` skill exactly: read `.agents/skills/concept-doc/SKILL.md` first and follow every step it gives, including its whole "Read first" list, its example bar (`.agents/skills/concept-doc/example/CONCEPT.md`, read all of it), "The shape", the "Writing rules", and "Checking it before you call it done" (the cold read and the bar check).

There is no user in this run to iterate with. Treat yourself as having the user's agreement once the cold read passes; do not ask questions. Where the skill says to ask or to settle a disagreement with the user, record it in the doc's Decisions section with your recommendation instead.

**Medium.** Write a markdown file (not Claude Docs) at the path given below. Figures go in `out/b/figures/`, named with the page's slug as a prefix. Use mermaid or SVG as `docs/contributing/spec-figures.md` says. If you draw SVG, render it to look at it; a Chromium binary is at `/opt/pw-browsers/chromium-1243/chrome-linux*/chrome` (headless screenshot).

**The newcomer reader** is someone who knows TypeScript and React, has never seen Flow State, and wants to build their own agent app.

**The release.** Write for the release that ships kits. Kits are specified and not all built: the planned surface is in `specs/epics/FIX-2618/` (SPEC.md, DECISIONS.md, examples/) and its child specs under `specs/issues/FIX-2619` through `specs/issues/FIX-2629` (FIX-2626 is the kit mechanism, FIX-2627 makes workforce and the coding harnesses kits). Treat that planned kit surface as the target where your topic touches it, and describe the rest from the code in `packages/`. Your "Where today's code differs" table is where the gap between the planned surface and today's code goes.

**Do not read** anything under `docs/internal/`, or any other spec besides the ones named above. Do not look for or read any other draft of this page.

**The cold read.** Run it as the skill says, with a fresh agent that gets only the doc. The cleanest way: write the questions and the doc into one file and run `claude -p --tools "" < that-file` from an empty directory such as `/tmp/coldread-<slug>/`, so the reader has no tools and no repo. Fix the doc from what it got wrong and rerun with a new reader, until it passes or you have run it three times.

When you are done, also write `out/b/<slug>.process.md`: the questions you asked each cold reader, what each got wrong, what you changed, and the bar-check result, in under 400 words. Your final message: the doc's path, its word count, and one line on the cold-read outcome.

Your topic:
