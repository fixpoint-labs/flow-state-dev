import type { Meta, StoryObj } from "@storybook/react-vite";
import type { FileContent } from "@flow-state-dev/core/items";

import {
  AttachButton,
  AttachmentPreview,
  AttachmentStrip,
  useAttachments,
  type AttachmentUploader,
} from "./attachments";
import {
  PromptInput,
  PromptInputAttachButton,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "./prompt-input";

const meta = {
  title: "Components/Attachments",
  component: AttachmentPreview,
  parameters: { layout: "padded" },
} satisfies Meta<typeof AttachmentPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Answers as the upload route does, a second later, without a server. */
const storyUploader: AttachmentUploader = {
  upload: async ({ data, mediaType, filename }): Promise<FileContent> => {
    await new Promise((done) => setTimeout(done, 1000));
    return {
      type: "file",
      mediaType: mediaType ?? data.type,
      ...(filename ? { filename } : {}),
      data: `fsd-blob:b_${Math.random().toString(36).slice(2, 12).padEnd(10, "0")}`,
    };
  },
};

const FrameStyle = { width: 640 };

/** PromptInput with paste, + and drop: try pasting a screenshot. */
export const InPromptInput: Story = {
  args: { filename: "", mediaType: "" },
  render: () => (
    <div style={FrameStyle}>
      <PromptInput client={storyUploader} onSubmit={(message) => console.log(message)}>
        <PromptInputAttachments />
        <PromptInputBody>
          <PromptInputTextarea placeholder="Paste, drop, or press +" />
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputAttachButton />
            </PromptInputTools>
            <PromptInputSubmit status="ready" />
          </PromptInputFooter>
        </PromptInputBody>
      </PromptInput>
    </div>
  ),
};

function OwnComposer() {
  const attachments = useAttachments({ client: storyUploader });
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3" style={FrameStyle} {...attachments.dropTarget}>
      <AttachmentStrip attachments={attachments} />
      <textarea className="min-h-16 w-full resize-none bg-transparent text-sm outline-none" onPaste={attachments.onPaste} placeholder="An app's own composer" />
      <div className="flex justify-between">
        <AttachButton attachments={attachments} />
        <button className="text-sm" onClick={async () => console.log(await attachments.take())} type="button">
          Send
        </button>
      </div>
    </div>
  );
}

/** The hook and the strip in a composer that isn't PromptInput. */
export const InYourOwnComposer: Story = {
  args: { filename: "", mediaType: "" },
  render: () => <OwnComposer />,
};

/** One file each way: uploading, ready, refused, a chip, and an image that can't be read. */
export const Previews: Story = {
  args: { filename: "", mediaType: "" },
  render: () => (
    <div className="flex flex-wrap gap-3">
      <AttachmentPreview filename="report.pdf" mediaType="application/pdf" size={812_000} status="uploading" onRemove={() => undefined} />
      <AttachmentPreview filename="spec.pdf" mediaType="application/pdf" size={1_400_000} status="ready" onRemove={() => undefined} />
      <AttachmentPreview filename="photo.png" mediaType="image/png" refusal="photo.png isn't supported" status="refused" onRemove={() => undefined} />
      <AttachmentPreview filename="gone.png" mediaType="image/png" src="/missing.png" />
    </div>
  ),
};
