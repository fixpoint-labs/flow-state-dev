/**
 * The thinking-style surface after the coordination-pattern shed (FIX-1478).
 *
 * Five in-request coordination routes, the `auto` entry and the intent
 * classifier behind it were removed. What is left is the direct answer and
 * the durable hand-off — and the two doors an old value can arrive through,
 * which answer it differently on purpose:
 *
 * - **A caller-sent style is refused** (BP-031). An input is a live claim.
 * - **A stored style is folded to `default`** (BP-030). History is tolerated,
 *   because a person whose last turn used a removed style has no action to
 *   take and their session must still open.
 *
 * Every check below names the change that makes it fail. Each red state was
 * produced before the check was committed — a deletion pass is exactly where
 * a check that cannot fail hides, because the code it aims at is gone.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { mockGenerator, testBlock, testRouter } from "@flow-state-dev/testing";
import chatAgentFlow from "../flows/chat-agent/flow";
import { thinkingStyleRouter, backgroundWorkTasks } from "../flows/chat-agent/run/thinking-styles";
import { resolveThinkingStyle } from "../flows/chat-agent/run/steps";
import { artifactsCollection } from "../flows/chat-agent/shared/artifacts";
import {
  RESOLVED_THINKING_STYLES,
  coalesceThinkingStyle,
  inputSchema,
  userStateSchema,
} from "../flows/chat-agent/shared/schemas";
import { STYLE_OPTIONS, getStyleOption } from "../components/thinking-style-selector";

/** The styles this app used to offer, in the order the menu listed them. */
const REMOVED_STYLES = [
  "auto",
  "plan-and-execute",
  "supervisor",
  "routed-specialists",
  "evented-actors",
  "moderated-debate",
] as const;

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const emptyWorkingMemory = { entries: [], currentTurn: 0 };
const emptyMemorySystem = {
  lastProcessedIndex: -1,
  episodicWritesSinceLastConsolidation: 0,
  evictedPersistentSinceLastConsolidation: 0,
  lastConsolidationTurn: 0,
};

const testFlow = defineFlow({
  kind: "thinking-styles-test",
  task: { actions: backgroundWorkTasks },
  actions: {
    run: { inputSchema, block: thinkingStyleRouter },
  },
  session: {
    stateSchema: z.object({
      mode: z.enum(["ask", "build", "interview", "debate"]).default("ask"),
      thinkingStyle: z.enum(["default", "background-work"]).optional(),
      features: z.object({ biasCheck: z.boolean().default(false) }).default({}),
    }),
    resources: { artifacts: artifactsCollection },
  },
  user: { stateSchema: userStateSchema },
})({ id: "thinking-styles-test" });

/** A turn's input, with the pieces a check doesn't care about filled in. */
function runInput(message: string, thinkingStyle = "default") {
  return {
    message,
    mode: "ask" as const,
    thinkingStyle,
    features: { biasCheck: false, search: true, fetch: true, crawl: false },
  };
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The live claim — a caller-sent style (BR-7, BR-8)
// ---------------------------------------------------------------------------

describe("a style named on the action input", () => {
  it.each(REMOVED_STYLES)("refuses %s, naming what it does accept", (style) => {
    const parsed = inputSchema.safeParse(runInput("hello", style));

    expect(parsed.success).toBe(false);
    // The error has to say what IS accepted — a caller wiring this up reads
    // the message, not this file.
    const message = JSON.stringify(parsed.error?.issues);
    expect(message).toContain("default");
    expect(message).toContain("background-work");
    // Red state: put the style back on `RESOLVED_THINKING_STYLES` and the
    // parse succeeds.
  });

  it("accepts the two that survive, and defaults when none is named", () => {
    expect(inputSchema.parse(runInput("hello", "default")).thinkingStyle).toBe("default");
    expect(inputSchema.parse(runInput("hello", "background-work")).thinkingStyle).toBe(
      "background-work",
    );
    const { thinkingStyle: _omitted, ...withoutStyle } = runInput("hello");
    expect(inputSchema.parse(withoutStyle).thinkingStyle).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// The stored value — a session written before the shed (BR-5, BR-6)
// ---------------------------------------------------------------------------

describe("a style stored on a session written before the shed", () => {
  /**
   * The real projection off the real flow, not a copy of it.
   *
   * `modeStatus` is the one surface that reads `session.state.thinkingStyle`
   * raw: the engine adopts stored session state with a bare cast and never
   * applies `stateSchema` to it, and `resolveThinkingStyle` overwrites the
   * value every turn before the router reads it. So a check aimed at a turn
   * would pass whether or not the fold exists. This one is aimed at the
   * projection, which is where the stored value actually escapes to a
   * browser.
   */
  const modeStatus = (
    chatAgentFlow as unknown as {
      session?: { client?: { derived?: Record<string, (ctx: unknown) => unknown> } };
    }
  ).session?.client?.derived?.modeStatus;

  it("is wired to the flow at all", () => {
    // Guards the rest of this block: if `modeStatus` is ever renamed or
    // dropped, the checks below would silently stop reading anything.
    expect(typeof modeStatus).toBe("function");
  });

  it.each(REMOVED_STYLES.filter((s) => s !== "auto"))(
    "reports default rather than %s",
    async (style) => {
      const out = (await modeStatus!({ state: { mode: "ask", thinkingStyle: style } })) as {
        thinkingStyle: string | null;
      };

      expect(out.thinkingStyle).toBe("default");
      // Red state: drop `coalesceThinkingStyle` from the projection in
      // `flows/chat-agent/flow.ts` and this reports "supervisor".
    },
  );

  it("passes a surviving style through untouched, and reports null for none", async () => {
    for (const style of RESOLVED_THINKING_STYLES) {
      const out = (await modeStatus!({ state: { mode: "ask", thinkingStyle: style } })) as {
        thinkingStyle: string | null;
      };
      expect(out.thinkingStyle).toBe(style);
    }

    const fresh = (await modeStatus!({ state: { mode: "ask" } })) as {
      thinkingStyle: string | null;
    };
    expect(fresh.thinkingStyle).toBeNull();
  });

  it("folds a corrupt value instead of making the session unopenable", () => {
    // Different from the persisted-model precedent, which throws on a
    // non-string. This one runs on every session read, so a corrupt value
    // costs a person their conversation rather than a log line.
    expect(coalesceThinkingStyle(42)).toBe("default");
    expect(coalesceThinkingStyle({})).toBe("default");
    expect(coalesceThinkingStyle(null)).toBeNull();
    expect(coalesceThinkingStyle(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The menu (BR-1, BR-6)
// ---------------------------------------------------------------------------

describe("the menu above the prompt", () => {
  it("offers exactly the direct answer and the durable hand-off", () => {
    expect(STYLE_OPTIONS.map((o) => o.value)).toEqual(["default", "background-work"]);
    // Red state: restore any removed entry and the list is longer.
  });

  it("opens on the direct answer for a style it no longer has", () => {
    for (const style of REMOVED_STYLES) {
      expect(getStyleOption(style).value).toBe("default");
      expect(getStyleOption(style).label).toBe("Default");
    }
    // Red state: reorder STYLE_OPTIONS so `background-work` is first, and a
    // person returning from a removed style opens on the hand-off — which
    // files their next message instead of answering it.
  });

  it("agrees with the schema about what a person can pick", () => {
    expect(STYLE_OPTIONS.map((o) => o.value).sort()).toEqual(
      [...RESOLVED_THINKING_STYLES].sort(),
    );
    // Red state: add a menu entry without adding it to the schema and the
    // person picking it gets a validation error instead of an answer.
  });
});

// ---------------------------------------------------------------------------
// No classification happens any more (BR-3, BR-4)
// ---------------------------------------------------------------------------

describe("a message carrying the words that used to steer it", () => {
  // Every one of these was a keyword the removed classifier matched on.
  const steering =
    "Orchestrate the team: delegate to multiple agents, debate both sides in a " +
    "shared workspace, then break it down step by step and argue the pros and cons.";

  it("is answered directly, with no classifier call to pay for", async () => {
    const result = await testBlock(resolveThinkingStyle, {
      input: { ...runInput(steering), thinkingStyle: "default" },
      flow: testFlow,
    });

    expect(result.error).toBeNull();
    expect(result.state.session).toMatchObject({ thinkingStyle: "default" });
    // Red state: restore `"auto"` on the input schema and this write — the
    // persisted style is no longer the caller's surviving choice.
  });

  it("reaches the direct-answer route, not a coordination one", async () => {
    const assistantFixture = mockGenerator({
      name: "assistant-generator",
      script: [{ text: "Answered in the turn." }],
    });
    const observeFixture = mockGenerator({
      name: "memory/observe",
      script: [{ structuredOutput: { items: [] } }],
    });

    const routed = await testRouter(thinkingStyleRouter, {
      input: runInput(steering),
      flow: testFlow,
      session: {
        state: { thinkingStyle: "default", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      generators: {
        "assistant-generator": assistantFixture,
        "memory/observe": observeFixture,
      },
    });

    expect(routed.error).toBeNull();
    expect(routed.selectedRoute).toBe("assistant-generator");
  });

  it("still routes the durable hand-off, which is the one that stayed", async () => {
    const routed = await testRouter(thinkingStyleRouter, {
      input: runInput("Write me a briefing on this", "background-work"),
      flow: testFlow,
      session: {
        state: { thinkingStyle: "background-work", features: { biasCheck: false } },
        resources: { workingMemory: emptyWorkingMemory, memorySystem: emptyMemorySystem },
      },
      unmockedGeneratorPolicy: "warn",
    });

    expect(routed.selectedRoute).not.toBe("assistant-generator");
  });
});

// ---------------------------------------------------------------------------
// The sweep (BR-4, BR-10, BR-11, BR-13)
// ---------------------------------------------------------------------------

describe("what the shed left behind", () => {
  /**
   * The renderers that draw turns from before the change.
   *
   * They name the removed patterns because that is what the items they draw
   * are called. A person scrolling back has to keep seeing their old turns,
   * so these are named here rather than collected by a later pass (BR-13).
   */
  const HISTORY_RENDERERS = [
    "components/flow-state/routed-specialists.tsx",
    "components/flow-state/evented-actors.tsx",
    "components/flow-state/debate.tsx",
    "components/flow-state/task-plan.tsx",
    "components/flow-state/task-plan-state.ts",
    "components/flow-state/tool-summaries.ts",
    "components/flow-state/chat-assistant.tsx",
  ];

  it("imports the coordination-patterns package in exactly one file", () => {
    // Anchored to the import statement, not the package name:
    // `task-plan-state.ts` names the package in a doc comment, so a bare
    // name search returns two files after a correct implementation and
    // reads as a failure.
    const importing = sourceFiles(APP_ROOT)
      .filter((f) => /from\s+["']@flow-state-dev\/patterns/.test(readFileSync(f, "utf8")))
      .map((f) => relative(APP_ROOT, f));

    expect(importing).toEqual(["flows/chat-agent/run/bias-check.ts"]);
    // Red state: add the import back to any other file.
  });

  it("proves the anchor is doing work, not passing by luck", () => {
    // If this ever returns only the importing files, the check above has
    // stopped distinguishing an import from a mention and the anchoring
    // comment is no longer true.
    const mentioning = sourceFiles(APP_ROOT)
      .filter((f) => readFileSync(f, "utf8").includes("@flow-state-dev/patterns"))
      .map((f) => relative(APP_ROOT, f));

    expect(mentioning).toContain("components/flow-state/task-plan-state.ts");
    expect(mentioning.length).toBeGreaterThan(1);
  });

  it("holds no reference to the classifier or the filters it fed", () => {
    const dead = [
      "thinking-style-classifier",
      "intentClassifier",
      "supervisorWorkerView",
      "normalizeDeps",
      "inferThinkingStyle",
      "item-inference",
      "autoClassifyStyle",
    ];

    const hits: string[] = [];
    for (const file of sourceFiles(APP_ROOT)) {
      // This file names them all, as the list above — scanning itself would
      // make the check unfailable in the other direction.
      if (file === fileURLToPath(import.meta.url)) continue;
      const body = readFileSync(file, "utf8");
      for (const name of dead) {
        if (body.includes(name)) hits.push(`${relative(APP_ROOT, file)} → ${name}`);
      }
    }

    expect(hits).toEqual([]);
    // Red state: restore `classify.ts`, or `lib/item-inference.ts`, or the
    // mock registered under the classifier's string key — none of which
    // typecheck would have caught.
  });

  it("keeps the renderers that draw turns from before the change", () => {
    for (const renderer of HISTORY_RENDERERS) {
      expect(() => statSync(join(APP_ROOT, renderer))).not.toThrow();
    }
    // Red state: delete one as part of a later sweep and a person scrolling
    // back to an old turn sees nothing where their answer was.
  });
});
