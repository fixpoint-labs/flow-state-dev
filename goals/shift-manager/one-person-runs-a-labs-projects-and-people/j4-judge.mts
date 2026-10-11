/**
 * J4's judge: Jev reads each step the docs-only writer logged as *doc silent*
 * against the docs the writer was given, so only a real docs gap fails J4.
 *
 * A writer's own report of a guess is noisy: run to run, it logs steps the
 * docs do answer, steps the task never asked for, and steps about the Lab's
 * own code. For each line, the sections of the writer's pages that share the
 * most words with it (a long one cut to its nearest paragraphs) are handed
 * to Jev beside the task and the line. Jev answers two choice questions:
 * whether those sections answer the step, the step is a gap, or it is outside
 * what the task asked for; and which section it read for that. A *gap* fails J4. A
 * sure *answered* or *outside*, at {@link JUDGE_FLOOR} or above, drops the
 * line. An unsure one is noisy too: Jev's confidence on the same line swings
 * across the floor from call to call. So an unsure line is judged
 * {@link JUDGE_CALLS} times in all, and fails J4, naming the section Jev cited,
 * only when most of those calls are not a sure drop. A line Jev is unsure
 * about every time still fails, as a cut docs section does.
 *
 * The model is `typesafe-ai/jev` through the AI Gateway, as DevTeam's coder
 * judge runs it (FIX-1866 D4).
 */
import { choice, defineFlow, evaluator, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createInMemoryStores, createModelResolver, createResponseEmitter, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import { stripIntentOverrides } from "../../lib/index.mts";

/** The evaluation model the judge runs on. */
export const JUDGE_MODEL = "typesafe-ai/jev";

/**
 * The confidence a drop must reach. Set against the controls: Jev answers a
 * cut section's line below 0.3, and the same line on the full docs at 0.7.
 */
export const JUDGE_FLOOR = 0.6;

/** How many times in all an unsure line is judged; it fails when most of them aren't a sure drop. */
export const JUDGE_CALLS = 3;

/** How many sections of the docs Jev reads per line, and how much of each. */
const SECTIONS_PER_LINE = 6;
const SECTION_CHARS = 4000;

/** What Jev decides about one line, as it is offered the choice. */
const VERDICTS = {
  answered: "One of the doc sections says how to do this step, or says enough that the step follows from it.",
  gap: "The task asks for this step, and none of the doc sections says how to do it.",
  outside: "The task doesn't ask for this step: it is an extra the task never mentions, or only a read or check of the Lab's own code.",
} as const;

/** One section of a docs page: from one heading to the next. */
export interface DocSection {
  page: string;
  heading: string;
  text: string;
}

/** Jev's verdict on one doc-silent line. */
export interface JudgedLine {
  line: string;
  verdict: keyof typeof VERDICTS;
  confidence: number;
  /** The probability Jev gave *gap*, when it reported one. */
  gap?: number;
  /** The section Jev cited, `page § heading`. */
  cited: string;
  /** Each call's verdict and confidence, when the first was unsure and the line was judged again. */
  calls?: { verdict: keyof typeof VERDICTS; confidence: number }[];
  /** Whether the line fails J4: a *gap*, or most of its calls not a sure *answered* or *outside*. */
  fails: boolean;
}

/** Split pages into their sections, by markdown heading. */
export function sectionsOf(pages: { page: string; text: string }[]): DocSection[] {
  return pages.flatMap(({ page, text }) => {
    const out: DocSection[] = [];
    let heading = "(top)";
    let body: string[] = [];
    const flush = () => {
      if (body.join("").trim() !== "") out.push({ page, heading, text: body.join("\n") });
      body = [];
    };
    let fenced = false;
    for (const line of text.split("\n")) {
      if (/^```/.test(line)) fenced = !fenced;
      const h = fenced ? null : /^#{1,4}\s+(.*)$/.exec(line);
      if (h !== null) {
        flush();
        heading = h[1]!.trim();
      }
      body.push(line);
    }
    flush();
    return out;
  });
}

const words = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z][a-z0-9_.-]{3,}/g) ?? []).map((w) => w.replace(/[.-]+$/, "")));

/** The sections that share the most words with a line, a code name counting three times. */
export function nearest(line: string, sections: DocSection[], k = SECTIONS_PER_LINE): DocSection[] {
  const plain = words(line);
  const code = words((line.match(/`[^`]+`/g) ?? []).join(" "));
  const scored = sections.map((s) => {
    const have = words(`${s.heading}\n${s.text}`);
    let score = 0;
    for (const w of plain) if (have.has(w)) score += code.has(w) ? 3 : 1;
    return { s, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.s);
}

/**
 * A section cut to {@link SECTION_CHARS}: whole, when it fits, or else its
 * paragraphs that share the most words with the line, kept in page order.
 */
export function excerpt(line: string, section: DocSection, chars = SECTION_CHARS): string {
  if (section.text.length <= chars) return section.text;
  const plain = words(line);
  const paras = section.text.split(/\n\s*\n/).map((text, at) => {
    const have = words(text);
    let score = 0;
    for (const w of plain) if (have.has(w)) score += 1;
    return { text, at, score };
  });
  const kept: typeof paras = [];
  let used = 0;
  for (const p of [...paras].sort((x, y) => y.score - x.score || x.at - y.at)) {
    if (used + p.text.length > chars) continue;
    kept.push(p);
    used += p.text.length + 2;
  }
  return kept.sort((x, y) => x.at - y.at).map((p) => p.text).join("\n\n");
}

/**
 * Judge each doc-silent line. Throws when Jev can't be reached, so the run
 * reports J4 blocked rather than passing on lines nobody judged.
 */
export async function judgeSilent(task: string, lines: string[], sections: DocSection[], model: string = JUDGE_MODEL): Promise<JudgedLine[]> {
  if (lines.length === 0) return [];
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("blocked: no AI_GATEWAY_API_KEY for J4's judge on Jev");
  stripIntentOverrides();
  const inputSchema = z.object({ task: z.string(), step: z.string(), sections: z.array(z.object({ id: z.string(), from: z.string(), text: z.string() })) });
  const judge = evaluator({
    name: "j4-doc-silent-judge",
    model,
    inputSchema,
    state: (input: z.infer<typeof inputSchema>) => ({
      task: input.task,
      "step the writer logged as doc silent": input.step,
      "doc sections": input.sections.map((s) => ({ id: s.id, from: s.from, text: s.text })),
    }),
    questions: (input: z.infer<typeof inputSchema>) => ({
      verdict: choice(
        "A writer given only these docs did the task, and logged this step as one no docs page told it how to do. " +
          "Read the step against the doc sections and the task. Which is true?",
        VERDICTS,
      ),
      section: choice(
        "Which doc section answers the step, or, if none does, which one comes closest?",
        Object.fromEntries([...input.sections.map((s) => [s.id, s.from]), ["none", "None of them is about this step."]]),
      ),
    }),
  });
  const flow = defineFlow({ kind: "j4-judge", actions: { judge: { inputSchema, block: judge } } })();
  const resolver = createModelResolver();
  const once = async (line: string, picked: { id: string; from: string; text: string }[], sessionId: string): Promise<JudgedLine> => {
    const requestId = `req_${sessionId}`;
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "judge",
      input: { task, step: line, sections: picked },
      requestId,
      userId: "j4_judge",
      sessionId,
      stores: createInMemoryStores(),
      responseEmitter: createResponseEmitter({ requestId, now: () => Date.now() }),
      runtimeConfig: { modelResolver: resolver },
    });
    if (result.error !== undefined) throw new Error(`J4's judge failed on "${line.slice(0, 80)}": ${result.error.message}`);
    const answers = (result.output as { answers: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number> }> }).answers;
    const verdict = answers.verdict?.choice as keyof typeof VERDICTS | undefined;
    if (verdict === undefined || !Object.hasOwn(VERDICTS, verdict)) throw new Error(`J4's judge answered no verdict for "${line.slice(0, 80)}"`);
    const confidence = answers.verdict?.confidence ?? 0;
    const sectionId = answers.section?.choice;
    const cited = picked.find((s) => s.id === sectionId)?.from ?? (picked.length === 0 ? "no section shares a word with the step" : "none of the sections it read");
    const gap = answers.verdict?.probabilities?.gap;
    return { line, verdict, confidence, gap, cited, fails: verdict === "gap" || confidence < JUDGE_FLOOR };
  };
  const out: JudgedLine[] = [];
  for (const [i, line] of lines.entries()) {
    const picked = nearest(line, sections).map((s, j) => ({ id: `s${j + 1}`, from: `${s.page} § ${s.heading}`, text: excerpt(line, s) }));
    const first = await once(line, picked, `j4_judge_${i}`);
    if (first.verdict === "gap" || !first.fails) {
      out.push(first);
      continue;
    }
    const calls = [first];
    for (let n = 1; n < JUDGE_CALLS; n++) calls.push(await once(line, picked, `j4_judge_${i}_${n}`));
    const failing = calls.filter((c) => c.fails).length;
    // The line reads as the call that decided it: the first failing call, or the first sure drop.
    const shown = failing * 2 > calls.length ? first : calls.find((c) => !c.fails)!;
    out.push({ ...shown, calls: calls.map((c) => ({ verdict: c.verdict, confidence: c.confidence })), fails: failing * 2 > calls.length });
  }
  return out;
}
