/**
 * The closure's held-out fixtures, drawn new for every run: the values planted
 * in separate files, the files a knowledge answer must look up, the skill's
 * marker, the decision kept across a fold and the option it replaced, the
 * one-line question's fact, and (Kitchen Sink only) a question drawn from a
 * pool whose answer needs three published doc pages. Nothing here is a
 * constant a correct app could have learned: another draw must pass it too.
 */
import { randomInt } from "node:crypto";
import type { Fixtures } from "./asks.mts";

const pick = <T,>(list: readonly T[]): T => list[randomInt(0, list.length)]!;
const value = () => `LC-${randomInt(100_000, 999_999)}-${randomInt(100, 999)}`;

/** The files a run plants in the project (or working folder) its worker reads, by path. */
export type Planted = Record<string, string>;

/** One run's fixtures, the lines each ask puts to the worker, and the files to plant. */
export interface Draw {
  fixtures: Fixtures;
  /** What the person types, per ask. */
  lines: { date: string; multiFile: string; pages: string; coder: string; knowledge: string; knowledgeDocs: string; sizing: string; skill: string; fold: string };
  /** Files the multi-file and knowledge asks read, planted where the asked worker can read them. */
  files: Planted;
  /** The fitting skill, written into the asked worker's own `skills/` folder for the run. */
  skill: { name: string; body: string };
  /** The coder ask's file and the check command the run is given. */
  coder: { file: string; before: string; after: string; check: string; script: string };
  /** The fold ask's opening turn, the filler turns after it, and how many fillers. */
  fold: { opening: string; filler: (n: number) => string };
}

/** Kitchen Sink's multi-file pool: each answer needs facts from three separate published doc pages. */
const DOCS = "https://flow-state.dev";
export const DOC_ASKS: readonly { line: string; pages: string[]; facts: RegExp[] }[] = [
  {
    line: "Using the flow-state.dev docs: how many block kinds are there, how many of a conversation's last turns does the built-in worker's model get, and which store does the server ship with by default?",
    pages: ["/docs/fundamentals/blocks", "/docs/workforce/built-in-worker", "/docs/persistence/overview"],
    facts: [/\bfive\b|\b5\b/i, /\b50\b/, /in-memory|memory store/i],
  },
  {
    line: "Using the flow-state.dev docs: which request lifecycle hook always fires, success or failure; which standing-rules tool lists a worker's rules; and how many tiers does skillActivator run?",
    pages: ["/docs/fundamentals/flows", "/docs/workforce/standing-rules", "/docs/skills/activation"],
    facts: [/onFinished/, /rules[/_]read/, /\bthree\b|\b3\b/i],
  },
  {
    line: "Using the flow-state.dev docs: which state operation replaces state in full, which store adapter backs the bus across processes, and which block kind do you reach for when your code will branch on a model's answer?",
    pages: ["/docs/fundamentals/state-and-scopes", "/docs/persistence/overview", "/docs/fundamentals/blocks"],
    facts: [/setState/, /postgres/i, /evaluator/i],
  },
];

/** Kitchen Sink's knowledge pool: questions its docs answer, which a worker has to look up and cite. */
const DOC_KNOWLEDGE: readonly string[] = [
  "How does a worker in flow-state-dev decide which skill to load for a task? Look it up in the flow-state.dev docs and cite the page you read.",
  "How do I make a flow-state-dev session survive a server restart? Look it up in the flow-state.dev docs and cite the page you read.",
  "What does a flow-state-dev coordinator do with a post it cannot place? Look it up in the flow-state.dev docs and cite the page you read.",
];

const DECISIONS: readonly [string, string][] = [
  ["Postgres", "SQLite"],
  ["Kafka", "RabbitMQ"],
  ["Svelte", "Angular"],
  ["Terraform", "Pulumi"],
];

/** A new draw for one run. */
export function draw(): Draw {
  const codes = [value(), value(), value()];
  const files: Planted = {
    "ops/alpha.txt": `Service alpha\nDeploy code: ${codes[0]}\n`,
    "ops/regions/beta.md": `# Service beta\n\nDeploy code: ${codes[1]}\n`,
    "notes/gamma.txt": `gamma's deploy code is ${codes[2]}\n`,
  };
  // The knowledge ask: three services' timeouts in three files; which is longest, and where it says so.
  const timeouts = [randomInt(10, 60), randomInt(61, 120), randomInt(10, 60)];
  const services = ["ledger", "payouts", "search"];
  const order = [0, 1, 2].sort(() => randomInt(0, 3) - 1);
  services.forEach((service, i) => {
    files[`handbook/${service}.md`] = `# ${service}\n\nRequest timeout: ${timeouts[order[i]!]} seconds.\n`;
  });
  const a = randomInt(11, 89);
  const b = randomInt(11, 89);
  const marker = `RN-${randomInt(1000, 9999)}`;
  const [decision, rejected] = (() => {
    const pair = pick(DECISIONS);
    return randomInt(0, 2) === 0 ? pair : ([pair[1], pair[0]] as [string, string]);
  })();
  const project = `P-${randomInt(100, 999)}`;
  const doc = pick(DOC_ASKS);
  const skillLine = "Write a one-line release note for this change: the default step budget went from 20 to 50.";
  const exitWas = randomInt(2, 9);
  return {
    fixtures: {
      multiFile: { values: codes },
      pages: { pages: doc.pages, facts: doc.facts },
      knowledge: { minLookups: 3 },
      sizing: { answer: new RegExp(`\\b${a + b}\\b`), maxWords: 50 },
      skill: { name: "release-notes", loadTool: /^loadSkill$/, marker, asked: skillLine },
      fold: { decision, rejected },
    },
    lines: {
      date: "What's today's date?",
      multiFile: "What are the deploy codes in ops/alpha.txt, ops/regions/beta.md and notes/gamma.txt? List all three.",
      pages: doc.line,
      coder:
        `In check.mjs, change the exit code from ${exitWas} to 0 so the check passes, then run \`node check.mjs\` and tell me what you ran and how it went.`,
      knowledge: "Of the services in the handbook folder, which has the longest request timeout? Look it up, and cite the file that says so.",
      knowledgeDocs: pick(DOC_KNOWLEDGE),
      sizing: `Quick one: what is ${a} plus ${b}?`,
      skill: skillLine,
      fold: `On project ${project}, which option did we pick for the decision I gave you at the start? Answer with its name only.`,
    },
    files,
    skill: {
      name: "release-notes",
      body: [
        "---",
        "name: release-notes",
        "description: Use when writing a release note or a changelog line for a change.",
        "---",
        "",
        `Every release note starts with the tag ${marker}, then one sentence on what changed for the user.`,
        "",
      ].join("\n"),
    },
    coder: {
      file: "check.mjs",
      before: `process.exit(${exitWas});\n`,
      after: "process.exit(0);\n",
      check: "node check.mjs",
      script: `process.exit(${exitWas});\n`,
    },
    fold: {
      opening: `A decision for project ${project}: we picked ${decision} over ${rejected}. Keep it in mind; just reply "noted".`,
      filler: (n: number) => `Note ${n} for the log: nothing to do. Reply "ok".`,
    },
  };
}

/** The pages a Kitchen Sink pages-ask's fetches must reach, as full URLs (for a goal.md line). */
export const docUrl = (path: string) => `${DOCS}${path}`;
