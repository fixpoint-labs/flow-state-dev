/**
 * The goal-check utility surface.
 *
 * Deliberately small. It covers only the scaffolding every goal repeats —
 * verdicts, fixtures, env, paths, capture reading, harness driving, durable
 * setup — and nothing that belongs to an individual goal. The grading logic IS
 * the goal and stays in `run.mts`; retry POLICY stays there too (the corpus has
 * three, and they mean different things).
 *
 *   import { loadFixture, runGoal, runFsdev, readCapture } from "../../lib/index.mts";
 *
 * See `goals/README.md` → "Script techniques" for the rules these encode.
 */
export * from "./verdict.mts";
export * from "./fixture.mts";
export * from "./env.mts";
export * from "./paths.mts";
export * from "./capture.mts";
export * from "./driver.mts";
export * from "./durable.mts";
export * from "./model.mts";
export * from "./specs.mts";
