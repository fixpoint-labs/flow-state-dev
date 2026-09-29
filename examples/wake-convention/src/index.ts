import { pathToFileURL } from "node:url";
import { proposedHost } from "./host";
import { formatWalk, walkConvention } from "./walk";

export { proposedHost } from "./host";
export {
  EXAMPLE_ROOT,
  formatWalk,
  readSeatWakes,
  readTransportRegistry,
  walkConvention,
  type EventKind,
  type HookRef,
  type SeatWake,
  type TransportRecord,
  type WalkLeftover,
  type WalkResult,
} from "./walk";

async function main(): Promise<void> {
  const result = await walkConvention();
  process.stdout.write(`${formatWalk(result)}\n\n`);
  process.stdout.write("Proposed host (not wired)\n");
  for (const [key, value] of Object.entries(proposedHost)) {
    process.stdout.write(`  ${key}: ${Array.isArray(value) ? value.join(", ") : value}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
