# POC · does killing the `tsx` wrapper kill the server?

Premise under test: a goal that kills the process it spawned with `child.kill("SIGKILL")` has
crashed its server. `startShiftManager` spawns `tsx` without `detached`, and Shift Manager's
`every-stop-is-one-inbox-item` journey j3 kills it that way before restarting on the same store.

Run from the repository root (needs `pnpm install`):

```sh
node_modules/.bin/tsx specs/issues/FIX-2407/poc/wrapper-kill/drive.mts \
  "$PWD/node_modules/.bin/tsx" "$PWD/specs/issues/FIX-2407/poc/wrapper-kill/server.mts"
```

Result, 2026-10-31, tsx v4.21.0, node v22.23.4:

```
child.kill SIGKILL wrapper pid 1441 | before: up 1457 | after: up 1457
group SIGKILL wrapper pid 1475 | before: up 1491 | after: down
```

**Premise refuted.** `tsx` runs the script in a child node process. SIGKILL on the wrapper cannot
be relayed, so the server (pid 1457) keeps answering. Spawned `detached` and killed as a group,
it is gone. A restart goal that kills only the wrapper grades a host that never crashed: the
survivor keeps the old turn running on the same store while the "restarted" host reads it.
