---
"@flow-state-dev/devtool": patch
---

In the Trace tab, clicking a block's row now opens that block's detail directly beneath the row, indented to its depth, instead of at the bottom of the right-hand panel under the session's resources (FIX-2981). Clicking the row again closes it; Enter and Space do the same from the keyboard. One block's detail is open at a time, and opening another closes the first. The detail is the same as before (kind, status, start, duration, input, output, error, the copy button), its Output section is now open by default, and long values scroll inside a bounded height. The right-hand panel keeps Session Context and Resources, and still shows a block selected from another tab, such as a ref badge in the Stream.

Docs: apps/docs/docs/build/debug-a-run.md (step "Click `draft-reply`. The right-hand panel opens…", the Output "closed by default" line, and the four-panels figure's "block detail" box on the right) and apps/docs/docs/build/see-resource-loads.md (step 2, "The block's detail opens in the right-hand panel") now open under the row.
