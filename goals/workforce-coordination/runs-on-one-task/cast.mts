/**
 * The concept's cast, written as `WORKER.md` files at run time, so the topic, the held-out
 * word and the researcher's fact are picked per run and nothing in the repository holds them.
 *
 * - `desk.launch`: the built-in coordinator, routing everyone, its one delegate `desk.writer`.
 * - `desk.writer`: the built-in `agent` worker, delegate `desk.researcher`. It never knows the
 *   fact: it asks researcher, then fact-checks the fact in a step of its own run in a session of
 *   its own (`session: "new"`), then writes the draft.
 * - `desk.researcher`: the built-in `agent` worker, no delegates. Only its file holds the fact.
 * - `desk.chief` and `desk.editor`, for the team that hands out work (journey j1): a coordinator
 *   routing everyone to `desk.editor`, which files for researcher and waits on it with
 *   `getTask` in the same request.
 *
 * Leg c's tree (`variant: "fails"`) gives researcher a model that refuses every call, and has
 * writer file a second research task that depends on the first, so the first's failure has a
 * dependent to cancel.
 */
import { randomBytes, randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What a run picked: Alice's topic and words, and the fact only researcher's file holds. */
export interface Cast {
  topic: string;
  /** The held-out word Alice asks the draft to carry. */
  word: string;
  /** A second held-out word, sent only as a steer (journey j2). */
  steerWord: string;
  fact: string;
  /** The digits in the fact, which a draft that used it carries. */
  factMark: string;
}

const TOPICS = ["a solar lantern", "a folding kayak", "a pocket espresso maker", "a trail camera", "a smart plant pot", "a cordless glue gun"];
const WORDS = ["heron", "copper", "lantern", "marble", "saffron", "willow", "ember", "glacier", "orchid", "tinsel"];
const pickWord = () => `${WORDS[randomInt(WORDS.length)]}${randomBytes(2).toString("hex")}`;

/** Pick a topic, the held-out words and a fact for one run. */
export function pickCast(): Cast {
  const hours = 100 + randomInt(800);
  return {
    topic: TOPICS[randomInt(TOPICS.length)]!,
    word: pickWord(),
    steerWord: pickWord(),
    fact: `its battery lasts ${hours} hours on one charge`,
    factMark: String(hours),
  };
}

/** The ids the cast goes by. */
export const CAST = {
  launch: "desk.launch",
  writer: "desk.writer",
  researcher: "desk.researcher",
  chief: "desk.chief",
  editor: "desk.editor",
} as const;

const FIRST_STEP = {
  walk: `1. If you have not heard back from desk.researcher yet, file exactly one task for it with createTask (assignee "desk.researcher") asking for the product's key fact, and end your turn with one short line saying you are waiting on research. Don't write anything else yet, and don't wait on the task.`,
  fails: `1. If you have not heard back from desk.researcher yet, file two tasks for it, both assignee "desk.researcher", one call at a time. First call createTask alone, asking for the product's key fact, and read the taskId it returns. Only then call createTask a second time, asking for a customer quote about that fact, with deps: [that taskId]. Then end your turn with one short line saying you are waiting on research. Don't write anything else yet, and don't wait on either task.`,
};

/**
 * Write the tree under `dir` (`teams/desk/workers/<id>/WORKER.md`).
 * @param variant `walk` (legs a and b, the journeys) or `fails` (leg c)
 */
export function writeCast(dir: string, cast: Cast, variant: "walk" | "fails" = "walk"): string {
  const worker = (id: string, text: string) => {
    const at = join(dir, "teams", "desk", "workers", id);
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, "WORKER.md"), text, "utf8");
  };
  worker(
    "launch",
    `---
description: Takes launch writing requests and hands them to the writer.
flow: coordinator
routing: everyone
model: goal/real
delegates: [desk.writer]
---

Hand each request to the writer.
`,
  );
  worker(
    "writer",
    `---
description: Writes launch posts. Asks desk.researcher for product facts.
model: goal/real
delegates: [desk.researcher]
---

You are desk.writer. You write short launch posts. You never know a product fact yourself: desk.researcher does.

If what you are given starts with "Fact-check", it is a step you filed for yourself: file nothing, call no tool, and answer only "Checked: " followed by the fact it names. Nothing else.

When you are asked to draft a launch post:
${FIRST_STEP[variant]}
2. When desk.researcher's task comes back with the fact, file exactly one step for yourself with createTask: assignee "desk.writer", session "new", goal "Fact-check: " followed by the fact as researcher stated it. Then end your turn with one short line. Don't write the draft yet.
3. When you are told your steps have ended, answer with the finished post: three sentences at most, using the fact exactly as researcher stated it and every word the person asked for, including any word they added while you worked.

If research fails, answer with one line saying the post can't be written without the fact.

When you are asked for a new version of a post you already wrote, write it from the earlier version, keeping the fact and the person's words.
`,
  );
  worker(
    "researcher",
    `---
description: Knows the product facts.
model: ${variant === "fails" ? "goal/broken" : "goal/real"}
---

You are desk.researcher. The product fact you know: ${cast.fact}. When you are asked for a fact, answer with that fact in one sentence, exactly as written here. When you are asked for a customer quote, answer with one short made-up quote that mentions the fact.
`,
  );
  worker(
    "chief",
    `---
description: Takes fact questions and hands them to the editor.
flow: coordinator
routing: everyone
model: goal/real
delegates: [desk.editor]
---

Hand each question to the editor.
`,
  );
  worker(
    "editor",
    `---
description: Answers product questions by asking desk.researcher.
model: goal/real
delegates: [desk.researcher]
---

You are desk.editor. You never know a product fact yourself. When you are asked a question about the product, file exactly one task for desk.researcher with createTask asking it, then wait for it in this same turn with getTask, passing the taskId and wait: true. When it comes back, answer in one sentence with the fact exactly as researcher stated it.
`,
  );
  return dir;
}
