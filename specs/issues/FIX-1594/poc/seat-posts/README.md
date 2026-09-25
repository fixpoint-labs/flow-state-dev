# poc/seat-posts — can a scripted seat post into its channel, as itself, keyless?

Throwaway, retained as evidence. Nothing under `specs/` is built, tested or walked by `fsdev gen`.
The probe boots kitchen-sink's real `fsdev.config.ts` (roster, channel boot, host principal) in
test mode, so the model is kitchen-sink's scripted resolver and no key is read. It calls the same
HTTP routes the page calls, in-process, on the dev (in-memory) profile.

`wiring.patch` is applied for the run and reverted after. It holds the smallest version of the
design: `seatId` imposed by the hire, a `post-to-channel` tool dispatching the channel's own
`post`, otto naming the tool, a scripted `agent-answer`, and, **as a stand-in for FIX-1590**, an
internal `receive` on the agent kind plus a notify slot that wakes otto on a person's post. The
stand-in is not a proposal for FIX-1590's shape.

```bash
git apply specs/issues/FIX-1594/poc/seat-posts/wiring.patch
cd apps/kitchen-sink
KITCHEN_SINK_TEST_MODE=1 pnpm exec tsx ../../specs/issues/FIX-1594/poc/seat-posts/probe.mts             # all PASS
KITCHEN_SINK_TEST_MODE=1 NEGATIVE=1 pnpm exec tsx ../../specs/issues/FIX-1594/poc/seat-posts/probe.mts  # P1, P2, P4 FAIL
cd ../.. && git apply -R specs/issues/FIX-1594/poc/seat-posts/wiring.patch
```

| # | Premise | Result |
|---|---|---|
| P1 | Talked to directly, otto's scripted tool call (no text, so the real tool runs) lands a line in `support.desk` with `author: support.otto`, `principal: devuser` | Held |
| P2 | Woken by a person's post through an internal dispatch, the same call lands the same line, and otto's line does not wake otto again | Held: one `receive` run, source `internal` |
| P3 | A scripted `author` argument is refused by the tool's closed input; no line is written | Held. Under the scripted model the whole turn fails |
| P4 | A channel otto is not in (`support.ada-wren`) refuses the post and writes nothing | Held, **and the seat's turn never sees the refusal**: the dispatch returns before the post runs. This is D3's cost |
| P5 | `support.iris`, which does not name the tool, makes the same scripted call and posts nothing | Held |

**Negative control (`NEGATIVE=1`, the tool sends no author):** P1 and P2 go red (the line reads
`devuser`), otto is woken a second time by its own line, and P4 goes red because a post with no
author skips the member check. The author is what makes the line attributable, the wake filter
possible and membership enforced.

Runs on `main` with FIX-1459 and FIX-1585's spec merged; FIX-1585's `channel-post` items are not
built yet, so the probe reads lines from the channel's state. Raw output:
[`evidence.txt`](evidence.txt).
