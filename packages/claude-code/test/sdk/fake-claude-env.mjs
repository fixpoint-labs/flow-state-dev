// A stand-in for the Claude Code CLI that records the environment it was
// started with, in its working directory, and exits. The installed Agent SDK
// spawns it exactly as it spawns the real CLI, so what lands in the file is
// what a real run's process — and every shell command its model runs — sees.
import { writeFileSync } from "node:fs";

writeFileSync("seen-env.json", JSON.stringify(process.env));
process.exit(1);
