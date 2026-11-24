---
title: Make it yours
type: start
description: Rewrite a worker's brief, add a worker, then run one of the app's flows from the terminal and read the same run in the DevTool.
---

import Figure from "@site/src/components/Figure";
import OneChange from "./figures/one-change-three-places.svg";

# Make it yours

A Flow State app is a folder of files you own. You change it by editing a file and running it again, and you read what happened in a trail the run leaves behind.

The workers in the starter are the plainest case. A worker is an AI agent with a name and a brief, and the brief is a Markdown file. On this page you rewrite a brief in the Teammates starter, add a worker, then run a worker's flow from the terminal and open the same run in the DevTool, the browser inspector that comes with `fsdev`. About ten minutes, after [Run a starter](./run-a-starter.md).

<Figure svg={OneChange} caption="One change, three places to see it" description={"Three columns joined by two arrows labelled RUNS and SHOWS. On the left, the edited WORKER.md for researcher, with its last line, Begin every answer with AHOY, highlighted as the line you changed. In the middle, a dashed box for the terminal: fsdev run agent respond prints one JSON object per line and ends with a flow_complete line whose output is AHOY, hello! The dashed outline marks that this output lasts one action run. On the right, a hatched box for the DevTool, opened on the session make-it-yours, listing the stream of items and the trace of blocks, including agent-answer, which wrote AHOY, hello!. The hatching marks what outlives the request. Two notes say that the file, the run and the trace are one change seen three ways, and that the DevTool reads the run back from the app's store."} />

## Rewrite a worker's brief

A worker's brief is its `WORKER.md`: settings between `---` fences, and below the second fence the instructions the worker is given. Open researcher's, at `workforce/teams/teammates/workers/researcher/WORKER.md`, and add a last line to the instructions:

```text
Begin every answer with AHOY.
```

Save it, then run it again. A running app read the `workforce/` folder once, when it started, so a running `fsdev dev` needs a restart before researcher follows the new brief, or start it with `fsdev dev --watch`, which restarts on each save. `fsdev run`, used below, is a new process every time, so its next run reads the saved file. Either way, researcher opens its next answer with AHOY.

The edit reaches every user of the app, except one who has edited researcher inside the app: that user keeps their own copy. [Workers](../concepts/workers.md) explains the copies.

## Add a worker

A folder with a `WORKER.md` in it is a worker. Put one beside researcher:

```md title="workforce/teams/teammates/workers/proofreader/WORKER.md"
---
description: Fixes spelling and grammar and says what it changed.
---

Return the corrected text, then one line saying what you changed.
```

`description` is the only setting the file needs, with instructions below the fences. A worker with no `flow:` setting runs on the built-in `agent` flow, which the next section runs.

The worker's id is the team folder and its own folder joined by a dot, `teammates.proofreader`. Use that id wherever you name the worker, as `--seed-session` does below. It must match the folders exactly: an id no worker has is refused, and nothing is stored. Restart the app, or run `fsdev dev --watch`, which also restarts when a new `WORKER.md` appears, and the team has a new worker, which every user gets. The [`WORKER.md` reference](../reference/worker-md.md) lists every setting.

## Look underneath: run one flow from the terminal

A flow is a self-contained part of the app's backend that a worker runs on, and an action is one thing you can ask it to do. `agent` is the built-in flow, and `respond` is its action for a message. From the starter's folder, `labs/teammates`:

```bash
pnpm fsdev run agent respond \
  --session make-it-yours \
  --seed-session '{"workerId":"teammates.researcher"}' \
  -i '{"message":"Say hello in one short sentence."}'
```

`fsdev run` runs the action inside the command, with no server and no browser, and a model call needs your provider key. A session is the record a flow keeps of a run of requests, and `--session` names it so you can find it again. `--seed-session` says which worker the session belongs to. A session of `agent` must name its worker when it is created, and the seed is read only then. Leave it off the first run and the run is refused with exit code 2, nothing stored. So is an id no worker has, such as `teammates.proofreeder`. To send a second message in the same conversation, pass `--session make-it-yours` again.

Stdout is one JSON object per line, and the last line is the result:

```text title="stdout"
{"type":"item_added", …}
…
{"type":"flow_complete","output":"AHOY, hello!", …}
```

## Watch the same run in the DevTool

The terminal output is gone once the command ends, but the run is not. `fsdev run` wrote its session and request to the app's own store, the one the DevTool reads. Run `pnpm fsdev dev` and open the address it prints. The `@flow-state-dev/devtool` package must be installed, or the command stops with `DevTool assets not found`.

Work down the navigator: the flow `agent`, then the session `make-it-yours`, then the request. Or add `?session=make-it-yours` to the address. A run made while the page is open appears when you reload.

The Stream tab lists every item of the request, in order: each message, tool call and reply. The trace view lays them out as a timeline by block, the steps a flow is built from, with each block's input and output. `agent-answer` is the block that wrote the reply, and a generator's panel shows the system prompt the model saw.

The DevTool acts as one user, the one the app's config names as `devtool.userId`. A run made as a different user does not show. The [CLI reference](../reference/cli.md) has the details.

The DevTool's panels are covered in [Debug a run](../build/debug-a-run.md).

## Next

- [Workers](../concepts/workers.md): the file, each user's copy of a worker, and how to hire another.
- [Flows and actions](../concepts/flows-and-actions.md): what `agent` is made of, and how to write a flow of your own.
- [Debug a run](../build/debug-a-run.md): the DevTool's panels, and reading a trace to find what went wrong.
- [CLI reference](../reference/cli.md): every flag `fsdev run` and `fsdev dev` take.
