# poc/wake-premises — can a post run each agent seat once, keyless?

Throwaway and retained as evidence. Nothing under `specs/` is built, tested or walked by
`fsdev gen`, and `wake.patch` is applied only for the run and reverted after. The probe boots
kitchen-sink's real `fsdev.config.ts` (roster, channel boot, test-mode resolver) and calls the
routes the page calls, in-process, on the dev (in-memory) profile. No model key.

```bash
git apply specs/issues/FIX-1590/poc/wake-premises/wake.patch
cd apps/kitchen-sink
KITCHEN_SINK_TEST_MODE=1 pnpm exec tsx ../../specs/issues/FIX-1590/poc/wake-premises/probe.mts                 # PASS
KITCHEN_SINK_TEST_MODE=1 POC_STUB=1 pnpm exec tsx ../../specs/issues/FIX-1590/poc/wake-premises/probe.mts      # control: FAIL W1 W3 W4 W6
KITCHEN_SINK_TEST_MODE=1 POC_NO_FILTER=1 pnpm exec tsx ../../specs/issues/FIX-1590/poc/wake-premises/probe.mts # control: FAIL W5
cd ../.. && git apply -R specs/issues/FIX-1590/poc/wake-premises/wake.patch
```

The patch is the design in its roughest form: an internal `onChannelPost` on the agent kind that
runs `run`'s own sequence; a notify factory in `channel-notify.ts` that routes each agent member
to a dispatcher keyed on the channel and everything else to the name-only block; `hire.ts` hiring
the seats first; and a one-line scripted reply for `agent-answer`. Its local `WAKE_ACTION` table
stands in for the column FIX-1585's map will carry, and must not ship.

| # | Premise | Result |
|---|---|---|
| W1 | A post with no author runs `support.iris` and `support.otto` once each: one conversation, the post heard once as the seat's turn, one scripted reply | Held. Red under the stub |
| W2 | `support.ada`, `support.grace` and `support.wren` hold nothing with the post's token | Held (true under the stub too, so it is not the leg's proof) |
| W3 | The seat's conversation is a dispatch run whose parent is `support.desk` | Held. Red under the stub |
| W4 | A second post lands in the same conversation of each seat | Held. Red under the stub |
| W5 | A post with `author: "support.otto"` wakes no seat | Held. Red with the author filter dropped: both agents ran, the writer included |
| W6 | The ordinary session listing hides the run; only `include: "dispatch-runs"` finds it | Held. This is why the plan turns on `includeDispatchRuns` in the rail |

Raw output: [`evidence.txt`](evidence.txt), run at `63013ebff` on 2026-09-25.
