/**
 * The goal's page: a chat composer an adopter writes from the installed
 * registry items (`prompt-input`, which brings `attachments`), sending to a
 * local server through `@flow-state-dev/client`. Copied into a fresh host that
 * installed them with `fsdev ui add`, as `goal/composer.tsx`.
 *
 * Send is enabled when there is text or a file, as an adopter wires it. The
 * message goes to the host's `send` action in one session, its files'
 * references riding beside the input as the send's `attachments`; the goal
 * reads that request on the wire.
 *
 * Under `GOAL_CONTROL=main-registry` the host holds `prompt-input` and
 * `message` as on `main`, which have no `client` prop, no strip and no +
 * button. The page then wires what `main` offers: the + is a toolbar button
 * calling `openFileDialog`, and the strip is absent.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@flow-state-dev/client";
import * as prompt from "@/components/flow-state/prompt-input";
import "../app/globals.css";

const { PromptInput, PromptInputButton, PromptInputSubmit, PromptInputTextarea, usePromptInputAttachments } = prompt;
type Parts = { PromptInputAttachments?: () => JSX.Element; PromptInputAttachButton?: () => JSX.Element };
const parts = prompt as unknown as Parts;

/** The host reads who is asking from `x-user`, standing in for sign-in. */
const signedIn: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("x-user", "goal-user");
  return fetch(input, { ...init, headers });
};
const flow = createClient({ baseUrl: location.origin, userId: "goal-user", fetcher: signedIn }).flow("chat");
/** Files belong to a conversation, so every send names this one. */
const session = flow.createSession();

/** `main`'s way to open the picker, when the registry has no + button. */
function MainAttachButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton aria-label="Attach files" onClick={() => attachments.openFileDialog()}>
      +
    </PromptInputButton>
  );
}

function SendButton({ text }: { text: string }) {
  const attachments = usePromptInputAttachments();
  return <PromptInputSubmit disabled={text.trim() === "" && attachments.files.length === 0} status="ready" />;
}

function Page() {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(0);
  const Strip = parts.PromptInputAttachments;
  const Attach = parts.PromptInputAttachButton ?? MainAttachButton;
  return (
    <main style={{ maxWidth: 640, margin: "40px auto" }}>
      <p data-testid="sent-count">{sent}</p>
      <PromptInput
        {...({ client: flow } as object)}
        onSubmit={async (message) => {
          const { id } = await session;
          await flow.send("send", { message: message.text }, { sessionId: id, attachments: message.attachments });
          setText("");
          setSent((n) => n + 1);
        }}
      >
        {Strip ? <Strip /> : null}
        <PromptInputTextarea onChange={(e) => setText(e.currentTarget.value)} value={text} />
        <Attach />
        <SendButton text={text} />
      </PromptInput>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
