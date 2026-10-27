/**
 * The closure's tree: DevTeam's own, copied, with the desk team the walk adds, written at run
 * time so the words Alice uses are picked per run and nothing in the repository holds them.
 *
 * - `desk.front`: the built-in `agent` worker Alice talks to, on the real model, whose
 *   delegates are the three below. Asked to, its model files a task held on a question.
 * - `desk.asker`: an `agent` worker on the real model that asks the person one question midway,
 *   with `askQuestion`, before it answers.
 * - `desk.doer`: the Lab's `doer` worker flow, a block that stops for an approval, a review or
 *   an input and reads the answer next (`lab/fsdev.config.mts`).
 * - `eng.coder`: DevTeam's coder, as DevTeam declares it.
 */
import { randomBytes, randomInt } from "node:crypto";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAB_TREE } from "../../../packages/shift-manager/teams/devteam/host.mts";

/** The model the walk's workers run on: the spec's, through the Lab's resolver. */
export const REAL_MODEL = "openai/gpt-6-luna";

/** The ids the walk goes by. */
export const CAST = {
  front: "desk.front",
  asker: "desk.asker",
  doer: "desk.doer",
  coder: "eng.coder",
} as const;

/** What a run picked: a word each task's goal carries, so a task is told apart from its neighbours. */
export interface Words {
  topic: string;
  /** The question `desk.front`'s model files a task held on. */
  heldQuestion: string;
  /** What `desk.asker` must ask about before it answers. */
  askerAbout: string;
}

const TOPICS = ["heron", "copper", "lantern", "marble", "saffron", "willow", "ember", "glacier", "orchid", "tinsel"];
const FORMATS = ["Which changelog format should it use?", "Which release channel should it name?", "Which audience should it address?"];
const ABOUTS = ["the tone the greeting should take", "the customer the greeting is for", "the season the greeting mentions"];

/** Pick a run's words. */
export function pickWords(): Words {
  return {
    topic: `${TOPICS[randomInt(TOPICS.length)]}${randomBytes(2).toString("hex")}`,
    heldQuestion: FORMATS[randomInt(FORMATS.length)]!,
    askerAbout: ABOUTS[randomInt(ABOUTS.length)]!,
  };
}

/** Write the tree under `dir`: DevTeam's, and the desk team beside it. */
export function writeTree(dir: string, words: Words): string {
  cpSync(LAB_TREE, dir, { recursive: true });
  const worker = (id: string, text: string) => {
    const at = join(dir, "teams", "desk", "workers", id);
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, "WORKER.md"), text, "utf8");
  };
  worker(
    "front",
    `---
name: Desk
description: The person's desk. Files work for the doer, the asker and the coder.
flow: agent
model: ${REAL_MODEL}
delegates: [desk.doer, desk.asker, eng.coder]
---

You are desk.front. You file work for your delegates with createTask, exactly as the person asks, and you never do the work yourself.

When the person asks you to file a task that must wait for their answer to a question before it starts, call createTask once with the goal they give, the assignee they name, and the question, word for word, as the only entry of questions. Then end your turn with one short line.

When the person tells you one of your tasks asked you a question and gives you the answer, read the task with getTask to find the question's id under holds, then answer it with updateTask, passing the task's id, the question's id as question, and their answer as message. Then end your turn with one short line saying what the tool answered.
`,
  );
  worker(
    "asker",
    `---
name: Asker
description: Writes short greetings, and always asks the person first.
flow: agent
model: ${REAL_MODEL}
---

You are desk.asker. You write one-line greetings.

On a task, if your brief holds no answer from the person yet, call askQuestion exactly once, asking them about ${words.askerAbout}, and then end your turn without writing the greeting. Once your brief holds their answer, write the one-line greeting using it and end your turn. Never ask twice.
`,
  );
  worker(
    "doer",
    `---
name: Doer
description: Does release chores, stopping for the person where the chore says to.
flow: doer
---

You are desk.doer.
`,
  );
  return dir;
}
