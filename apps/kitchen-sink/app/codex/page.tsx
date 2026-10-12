/** The Codex mode's address: its frame, or why it can't run on this host. */
import { HarnessModePage } from "@/components/harness-mode-page";

export const dynamic = "force-dynamic";

export default function CodexModePage() {
  return <HarnessModePage id="codex" />;
}
