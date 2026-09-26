# poc/wake-by-entry — can a stock wake pick its seats off the hired seats alone?

Throwaway and retained as evidence. Nothing under `specs/` is built, tested or walked by
`fsdev gen`. The script boots a real in-process host (`createFlowState`, in-memory stores) from
a four-seat fixture tree, with no kitchen-sink code and no model. The woken kind writes a line
to a file when it runs, so "it ran" is a side effect rather than a report.

It needs a checkout where the agent kind declares `onChannelPost` (FIX-1590's branch or later).
It was run from a checkout of FIX-1594's branch, with this directory's `node_modules` pointed at
that checkout's `goals/node_modules`:

```bash
tsx specs/issues/FIX-1602/poc/wake-by-entry/run.mts                               # PASS
GOAL_CONTROL=no-author-filter tsx specs/issues/FIX-1602/poc/wake-by-entry/run.mts # FAIL: the seat-post leg
```

| # | Premise | Result |
|---|---|---|
| P1 | A seat `hireWorkforce` returns carries its kind's internal entries. The built-in `agent` kind and a custom `listener` kind declare `onChannelPost`; a `note` kind with only a public action does not | Held. So the spec's [D2](../../DECISIONS.md#d2) needs no kind table, in the package or the host |
| P2 | A notify block built only from P1 wakes each declaring member once per post. It reuses one conversation per seat per channel, runs nothing for `desk.ned`, and runs nothing for a post naming an author | Held. Red with the author rule dropped: `desk.ivy`'s own post woke `desk.ivy` and `desk.oz` |

The conversation id each seat ran in (`dsx_…`) was the same across two separate runs. It comes
from the key `channel:<channelId>`. That is why the plan keeps that key byte for byte: kitchen-sink's
existing seat conversations continue after it moves onto the helper.

Not shown here: the built-in agent kind running on a woken post. FIX-1590's
[wake-premises POC](../../../FIX-1590/poc/wake-premises/README.md) showed that on kitchen-sink's
wiring. The goal check shows it again on a fresh host.

Raw output: [`evidence.txt`](evidence.txt).
