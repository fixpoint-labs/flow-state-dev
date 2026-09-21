/**
 * A custom worker kind, declared by living in `workforce/flows/workers/`.
 *
 * Nothing registers it. `fsdev gen` walks this folder and puts it on the
 * `kinds` map under its basename, `desk-clerk`, which is the name a
 * `WORKER.md` names in its `flow:` line. The flow's own `kind` has to agree
 * with that basename — `hireWorkforce` refuses the seat by name when it does
 * not.
 *
 * `cardinality: "collection"` is what a worker kind needs: a seat mints its own
 * copy under its own id, and a singleton's id has to equal its kind, so a
 * worker kind left at the default would be refused at admission.
 *
 * The settings schema composes the seat contract and then adds this kind's own
 * key. Composing it is what admits the seat's skills and its instructions; a
 * kind that declared only its own keys would be handed a bag it has not
 * declared and refused at the mint.
 */
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

import deskNote, { deskNoteInput, deskNoteOutput } from "../../blocks/desk-note";

/**
 * The `answer` action: run the desk block, then say what it answered.
 *
 * The emission is here rather than inside `desk-note` because only this path
 * wants it. A handler's return value rides its own `block_trace` row, and trace
 * items are `{ client: false, history: false }` by type — so without this the
 * demonstration is invisible to anyone holding the HTTP route, which is the
 * only place a reader meets it. The same block is also a tool a seat can name
 * in its `WORKER.md`, and on that path the seat gives its own answer; emitting
 * from the block would add a second, client- and history-visible turn there.
 */
const answer = sequencer({
  name: "desk-clerk-answer",
  inputSchema: deskNoteInput,
  outputSchema: deskNoteOutput,
})
  .step(deskNote)
  .tap((said, ctx) => {
    ctx.emit.message(`[${said.desk} desk] ${said.answered}`);
  });

export default defineFlow({
  kind: "desk-clerk",
  cardinality: "collection",
  // `desk` is this kind's own setting and sits at the top level of a worker
  // file, where the framework closes it: a seat declaring a key this schema
  // does not know is refused by name.
  configSchema: workerConfigSchema().extend({
    desk: z.string().default("front"),
  }),
  actions: {
    answer: { inputSchema: deskNoteInput, block: answer },
  },
});
