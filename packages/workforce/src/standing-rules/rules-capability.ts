/**
 * Standing rules on a worker's turn (FIX-1945 S3, S4): the list in context on
 * every turn, and the four rule tools on a turn a user's own message
 * started.
 *
 * One capability, composed onto the agent turn the `agent` and `coordinator`
 * flows share, so both carry it the same way:
 *
 * - **Context.** The worker's rules for the turn's user, numbered, after its
 *   own instructions, team instructions and packages. A task turn runs at the
 *   filing user's scope, so it reads that user's list. No rules, no
 *   text. A read that fails is said once in the trace and the turn runs
 *   without rules; it never fails the turn.
 * - **Tools.** `rules/read`, `rules/add`, `rules/change`, `rules/remove`, as
 *   `controlTools`: a worker's `tools:` line doesn't fence them, and they are
 *   offered only while the request carries the user-turn mark
 *   (`./user-turn`). Each write also refuses on an unmarked turn, so a task
 *   turn can't edit even by naming a tool. Each write that lands posts a line
 *   the user sees, from the tool, not from the model's reply.
 *
 * Every write names the version of the list the model last saw (the list in
 * context, or a tool's answer since), so a write racing a page edit is
 * refused with the list as it stands rather than landing on one it never saw.
 */
import { defineCapability, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { RULE_TOOLS, STANDING_RULES_LINE } from "./keys";
import { isUserTurn } from "./user-turn";
import { MAX_RULES, numberedRules, renderRules, type RuleEdit, type StandingRules } from "./rules-list";
import { STANDING_RULES_RESOURCE, readStandingRules, standingRulesCollection, writeStandingRules } from "./rules-record";

/** The version of the list the model last saw, by the request's session handle. */
const seen = new WeakMap<object, number>();
/** Requests whose failed rules read was already said in the trace. */
const saidReadFailed = new WeakSet<object>();

const resources = { [STANDING_RULES_RESOURCE]: standingRulesCollection };

/**
 * The rules as this turn reads them, or `undefined` for none or a failed read.
 * Records the version shown, so a write names the list the model saw.
 */
async function rulesContext(ctx: BlockContext): Promise<string | undefined> {
  let list: StandingRules;
  try {
    list = await readStandingRules(ctx);
  } catch (error) {
    if (!saidReadFailed.has(ctx.session as object)) {
      saidReadFailed.add(ctx.session as object);
      const reason = error instanceof Error ? error.message : String(error);
      ctx.emit?.status?.(`This turn runs without standing rules: they couldn't be read (${reason}).`, { transient: false });
    }
    return undefined;
  }
  seen.set(ctx.session as object, list.version);
  return renderRules(list);
}

/** The list as a tool answers it. */
const listOutput = (list: StandingRules) => ({ rules: numberedRules(list).map(({ number, text }) => ({ number, text })), max: MAX_RULES });

const ruleSchema = z.object({ number: z.number(), text: z.string() });
const listOutputSchema = z.object({ rules: z.array(ruleSchema), max: z.number() });
const toolOutputSchema = z.union([
  listOutputSchema.extend({ line: z.string() }),
  listOutputSchema.extend({ refused: z.string() })
]);

/** Apply `edit` from a tool, as the list the model last saw. */
async function toolWrite(ctx: BlockContext, edit: RuleEdit) {
  if (!isUserTurn(ctx)) {
    return {
      ...listOutput(await readStandingRules(ctx)),
      refused: "Standing rules change only on a turn a user started; this one can't edit them."
    };
  }
  const session = ctx.session as object;
  let version = seen.get(session);
  if (version === undefined) version = (await readStandingRules(ctx)).version;
  let outcome;
  try {
    outcome = await writeStandingRules(ctx, version, edit, ctx.session.identity.id);
  } catch (error) {
    const reason = `Not saved: ${error instanceof Error ? error.message : String(error)}`;
    const current = await readStandingRules(ctx).catch(() => undefined);
    // An unreadable record is said as such, never shown as an empty list.
    return current === undefined
      ? { rules: [], max: MAX_RULES, refused: `${reason} The current rules couldn't be read either; this list is not them.` }
      : { ...listOutput(current), refused: reason };
  }
  // The model sees this list now, refused or not, so the next write names it.
  seen.set(session, outcome.list.version);
  if (!outcome.ok) {
    if (outcome.full === true) {
      ctx.emit.message(`✎ Rule not added: ${outcome.reason}.`, {
        agentName: STANDING_RULES_LINE,
        itemVisibility: { client: true, history: false }
      });
    }
    return { ...listOutput(outcome.list), refused: `Refused: ${outcome.reason}.` };
  }
  ctx.emit.message(outcome.line, { agentName: STANDING_RULES_LINE, itemVisibility: { client: true, history: false } });
  return { ...listOutput(outcome.list), line: outcome.line };
}

const readTool = handler({
  name: RULE_TOOLS.read,
  description:
    "List your standing rules for this user, numbered. They are already in your instructions every turn; read them here before changing one.",
  inputSchema: z.object({}).strict(),
  outputSchema: listOutputSchema,
  resources,
  execute: async (_input, ctx) => {
    const list = await readStandingRules(ctx as never);
    seen.set(ctx.session as object, list.version);
    return listOutput(list);
  }
});

const addTool = handler({
  name: RULE_TOOLS.add,
  description:
    "Save a note this user gave you as a standing rule you follow in every later conversation with them. " +
    `Use it when they tell you how to work from now on. One line, at most 300 characters, in your words; at most ${MAX_RULES} rules. ` +
    "If the list is full, ask them which rule to merge or drop.",
  inputSchema: z.object({ text: z.string() }).strict(),
  outputSchema: toolOutputSchema,
  resources,
  execute: async (input, ctx) => toolWrite(ctx as never, { op: "add", text: input.text })
});

const changeTool = handler({
  name: RULE_TOOLS.change,
  description:
    "Rewrite one of your standing rules when this user asks you to change it. Name it by number and quote its current text exactly.",
  inputSchema: z.object({ number: z.number().int(), current: z.string(), text: z.string() }).strict(),
  outputSchema: toolOutputSchema,
  resources,
  execute: async (input, ctx) => toolWrite(ctx as never, { op: "change", ...input })
});

const removeTool = handler({
  name: RULE_TOOLS.remove,
  description:
    "Drop one of your standing rules when this user asks you to. Name it by number and quote its current text exactly.",
  inputSchema: z.object({ number: z.number().int(), current: z.string() }).strict(),
  outputSchema: toolOutputSchema,
  resources,
  execute: async (input, ctx) => toolWrite(ctx as never, { op: "remove", ...input })
});

/** The four rule tools. */
export const ruleTools = [readTool, addTool, changeTool, removeTool];

/** Standing rules on a worker's turn: the list in context, and the tools on a user's turn. */
export const standingRulesCapability = defineCapability({
  name: "standingRules",
  resources,
  presets: {
    rules: {
      context: (_input, ctx) => rulesContext(ctx as never),
      controlTools: (ctx) => (isUserTurn(ctx as never) ? ruleTools : [])
    },
    default: ["rules"]
  }
});
