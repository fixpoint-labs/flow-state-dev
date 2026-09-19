/**
 * VG — the goal check, on the real path.
 *
 * One seat, one capability, handed over twice: attached to the seat, then held
 * in a library and activated. **The seat does the same work both times.**
 *
 *   tsx --tsconfig spec-poc/FIX-1394-probes/tsconfig.json spec-poc/FIX-1394-probes/goal.mts
 *
 * Run against variant C, the candidate the ratify recommends. It is a goal
 * rather than a probe because it asks the outcome question the probes take
 * apart: not "did the instructions arrive" and "did the tool run" separately,
 * but "did the same authored bytes produce the same working seat through two
 * different doors".
 *
 * `n/a` is not an outcome here. It passes or it does not.
 */
import { CAPABILITY } from "./harness/contract.mts";
import { scratchRoot } from "./harness/probes.mts";
import { runSeat } from "./harness/real-path.mts";
import { hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { variantC } from "./variants/c-new-file.mts";

const failures: string[] = [];
const note = (line: string) => console.log(`  ${line}`);

for (const mode of ["attached", "library"] as const) {
  const build = await variantC.build(scratchRoot(`goal-${mode}`), mode);
  if (build === null) throw new Error("the ratified variant authored nothing");

  const loaded = await readWorkforce(build.root);
  const seats = hireWorkforce(loaded.workers, {
    kinds: build.kinds as never,
    seatBlocks: build.seatBlocks,
  });
  const holder = seats.find((s) => s.id === build.holder)!;

  // The turn on which the capability is supposed to be live. Attached, that is
  // every turn; held, it is the turn that activates it. That difference IS the
  // two modes, and it is the only difference the goal tolerates.
  const message = mode === "attached" ? "log the handover" : build.activationMessage!;
  const turn = await runSeat(holder, { message, callTool: CAPABILITY.toolName });

  console.log(`\n${mode}`);
  const checks: Array<[string, boolean]> = [
    ["the seat's turn completed", turn.error === undefined],
    ["the capability's instructions are in the prompt", turn.promptText.includes(CAPABILITY.instructions)],
    ["the capability's document is in the prompt", turn.promptText.includes(CAPABILITY.documentBody)],
    ["the capability's tool was offered", turn.toolsOffered.includes(CAPABILITY.toolName)],
    ["the capability's block actually ran", turn.toolRan],
  ];
  for (const [label, ok] of checks) {
    note(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures.push(`${mode}: ${label}`);
  }

  // The seat that holds nothing is the control in both modes: same tree, same
  // kind, no attachment, and it must come out of this unchanged.
  //
  // The error is part of the predicate, not a detail. A sibling whose turn
  // throws returns an empty prompt and no tools, which reads as "untouched" on
  // the three checks below — so without this line VG went green in exactly the
  // case it exists to catch, a candidate that made the sibling unusable.
  const bystander = await runSeat(seats.find((s) => s.id === build.bystander)!, {
    message,
    callTool: CAPABILITY.toolName,
  });
  const clean =
    bystander.error === undefined &&
    bystander.promptText.includes("SEAT CHARTER") &&
    !bystander.promptText.includes(CAPABILITY.instructions) &&
    bystander.toolsOffered.length === 0 &&
    !bystander.toolRan;
  note(`${clean ? "PASS" : "FAIL"}  a sibling seat that holds nothing still works and is untouched`);
  if (!clean)
    failures.push(
      `${mode}: a sibling seat that holds nothing was touched (error=${bystander.error ?? "none"}, tools=[${bystander.toolsOffered.join(", ")}])`,
    );
}

console.log(
  failures.length === 0
    ? "\nVG PASS — one authored capability, two attachment modes, the same working seat both times."
    : `\nVG FAIL — ${failures.length}:\n  ${failures.join("\n  ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
