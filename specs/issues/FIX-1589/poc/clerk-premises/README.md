# poc/clerk-premises — does the clerk shape work on kitchen-sink's real wiring, keyless?

Throwaway and retained as evidence. Nothing under `specs/` is built, tested or walked by
`fsdev gen`. The probe boots kitchen-sink's own `fsdev.config.ts` in test mode (the scripted
model, no key) and calls the same HTTP routes the page calls, in-process.

`clerk.patch` is the shape in [PLAN.md](../../PLAN.md)'s sketch as real code, against
`apps/kitchen-sink`: a `desk-clerk-answer` generator with one dispatcher tool into
`support.desk`'s `fileTask`, the desk-tag tap, `userMessage` on `answer`, and a scripted
clerk in the test resolver. It is evidence for the direction, not the implementation: it skips
the followups assignee and the file headers.

```bash
cd apps/kitchen-sink
git apply ../../specs/issues/FIX-1589/poc/clerk-premises/clerk.patch
pnpm exec tsx ../../specs/issues/FIX-1589/poc/clerk-premises/probe.mts     # all PASS
git apply -R ../../specs/issues/FIX-1589/poc/clerk-premises/clerk.patch
pnpm exec tsx ../../specs/issues/FIX-1589/poc/clerk-premises/probe.mts     # the control: today's echo
```

| # | Premise | With the patch | Today's `main` |
|---|---|---|---|
| Q1 | A note to `support.ada` gets a reply a model call made, carrying its marker and not the note | Held | FAIL: the reply is the note under `[front desk]` |
| Q7 | The reply is the seat's desk tag, then the model's words | Held: `[front desk] [clerk:answered] …` | FAIL |
| Q6 | The note is kept as the person's turn | Held | FAIL: no user turn |
| Q2 | A scripted tool call (a step with `toolCalls` and no text) runs the real dispatcher, and a row with the note's token lands on `support.desk.escalations`, readable over the same resource route the team panel reads | Held | FAIL: no row |
| Q3 | The `fileTask` request names `author: support.ada`, set by the kind, and the channel's roster check accepts it | Held | FAIL |
| Q4 | The boot still warns that `escalations` is unattended | Held | Held |
| Q5 | The filing is a completed `fileTask` request on `support.desk`'s own session | Held | FAIL |

Q2 also settles the premise the epic left open for this issue ([epic D3](../../../../epics/FIX-1592/DECISIONS.md#d3)):
a scripted tool call reaches another flow's action through a dispatcher, keyless. Raw output:
[`evidence.txt`](evidence.txt).
