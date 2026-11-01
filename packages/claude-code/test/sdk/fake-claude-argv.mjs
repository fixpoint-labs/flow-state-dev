// A stand-in for the Claude Code CLI that records the arguments it was started
// with, in its working directory, and exits. The installed Agent SDK spawns it
// exactly as it spawns the real CLI, so what lands in the file is how a real
// run is told which settings to load.
import { writeFileSync } from "node:fs";

writeFileSync("seen-argv.json", JSON.stringify(process.argv.slice(2)));
process.exit(1);
