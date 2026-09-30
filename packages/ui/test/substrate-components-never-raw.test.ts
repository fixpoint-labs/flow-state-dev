/**
 * Guard: no substrate component type reaches the raw-JSON dev fallback.
 *
 * `resolveItemVisibility` cannot help here. A `component` item is a
 * **structural** type, and structural types ignore `itemVisibility` entirely —
 * `docs/architecture/items.md` says so in as many words, and
 * `STRUCTURAL_DEFAULT` is `{ client: true, history: false }`. So every
 * component item the substrate emits is client-visible whatever it declares,
 * and an item whose type the registry does not name falls through
 * `ItemRenderer` to a `<pre>` of its own JSON.
 *
 * That fallback is a development aid. For an item the substrate emits about
 * itself it is a defect: the user sees a JSON blob in the thread about
 * bookkeeping they have no part in. The shipped registry therefore names every
 * substrate component type — either with a renderer (`task-board-meta` mounts
 * the board) or with `false`, which `ItemRenderer` reads as "do not render
 * this".
 *
 * Read as source text rather than imported, in the style of
 * `generative/renderer-surface.test.ts`: the assertion is about what the
 * shipped registry file declares, and importing it would drag the whole
 * renderer tree in to learn one fact.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.resolve(here, "../registry/components/chat-assistant.tsx");

/**
 * Component types the substrate emits about itself. A superset of the exclusion
 * set in `@flow-state-dev/contracts`' `items/task-attribution.ts` — the two
 * lists answer different questions (whose output is this, versus should a user
 * see it) but they are drawn from the same population, so a type added there
 * belongs here too.
 */
const SUBSTRATE_COMPONENTS = [
  "task-change",
  "task-board-meta",
  "task-board-recorder-failure",
  // `goalSeekLoop`'s stop reason and drain count, emitted once when the loop
  // exits. It is emitted at loop level, never inside a worker, so it carries no
  // `taskId` and is absent from the attribution list — but it is still the
  // substrate reporting on itself.
  "goal-seek-loop-termination",
];

describe("the shipped chat registry names every substrate component type", () => {
  const source = readFileSync(REGISTRY, "utf8");

  it.each(SUBSTRATE_COMPONENTS)(
    "%s is named, so it never reaches the raw-JSON fallback",
    (component) => {
      expect(source).toContain(`"${component}":`);
    }
  );

  it("suppresses the recorder-failure entry outright rather than rendering it", () => {
    // It has no card to be. The caller-visible signal is the run's own
    // failure; the entry exists so the failure survives the run, not so
    // somebody reads it in a chat thread.
    expect(source).toMatch(/"task-board-recorder-failure":\s*false/);
  });

  it("suppresses the goal-seek loop's termination signal: it is for tooling, not a reader", () => {
    // Tests and tooling read the stop reason off the stream. A user watching
    // the loop finish has no use for it, and without this entry sees a JSON
    // blob land in the thread the moment the loop concludes.
    expect(source).toMatch(/"goal-seek-loop-termination":\s*false/);
  });

  it("suppresses a routed channel's route record: it is bookkeeping, never a line", () => {
    // Every route a channel takes leaves one `channel-route` item on the
    // channel's session. The lines are `channel-post` items; the record says
    // who a post went to and why, and has no place in a thread.
    expect(source).toMatch(/"channel-route":\s*false/);
  });
});
