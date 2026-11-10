"use client";

import type {
  ChangeEvent,
  ComponentProps,
  FormEvent,
  FormEventHandler,
  HTMLAttributes,
  KeyboardEventHandler,
  PropsWithChildren,
  ReactNode,
} from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  CornerDownLeftIcon,
  ImageIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import type { FileContent } from "@flow-state-dev/core/items";
import { isSendKey } from "@flow-state-dev/react";
import {
  AttachmentFileInput,
  AttachmentStrip,
  useAttachments,
  type AttachmentUploader,
  type Attachments,
  type UseAttachmentsOptions,
} from "./attachments";
import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ============================================================================
// Neutral types — replace AI SDK imports
// ============================================================================

/** Framework-agnostic prompt status. Replaces ChatStatus from "ai". */
export type PromptStatus = "ready" | "submitting" | "streaming" | "error";

/**
 * A file a message carries. Replaces FileUIPart from "ai". In a submitted
 * message, `url` is the uploaded file's reference (`fsd-blob:<id>`), never its
 * bytes.
 */
export interface FileAttachment {
  type: "file";
  mediaType: string;
  url: string;
  filename?: string;
}

/** Framework-agnostic source attachment. Replaces SourceDocumentUIPart from "ai". */
export interface SourceAttachment {
  type: "source";
  sourceId: string;
  title?: string;
  url?: string;
  description?: string;
}

// ============================================================================
// Provider Context & Types
// ============================================================================

/** PromptInput's attachments: the `useAttachments` state it is built on. */
export type AttachmentsContext = Attachments;

export interface TextInputContext {
  value: string;
  setInput: (v: string) => void;
  clear: () => void;
}

export interface PromptInputControllerProps {
  textInput: TextInputContext;
  attachments: AttachmentsContext;
}

const PromptInputController = createContext<PromptInputControllerProps | null>(
  null
);
const ProviderAttachmentsContext = createContext<AttachmentsContext | null>(
  null
);

export const usePromptInputController = () => {
  const ctx = useContext(PromptInputController);
  if (!ctx) {
    throw new Error(
      "Wrap your component inside <PromptInputProvider> to use usePromptInputController()."
    );
  }
  return ctx;
};

// Optional variants (do NOT throw). Useful for dual-mode components.
const useOptionalPromptInputController = () =>
  useContext(PromptInputController);

export const useProviderAttachments = () => {
  const ctx = useContext(ProviderAttachmentsContext);
  if (!ctx) {
    throw new Error(
      "Wrap your component inside <PromptInputProvider> to use useProviderAttachments()."
    );
  }
  return ctx;
};

const useOptionalProviderAttachments = () =>
  useContext(ProviderAttachmentsContext);

export type PromptInputProviderProps = PropsWithChildren<
  UseAttachmentsOptions & {
    initialInput?: string;
  }
>;

/**
 * Optional global provider that lifts PromptInput state outside of PromptInput.
 * If you don't use it, PromptInput stays fully self-managed. Its attachment
 * options (`client`, `sessionId`, `accept`, `limits`) apply to every
 * PromptInput inside it.
 */
export const PromptInputProvider = ({
  initialInput: initialTextInput = "",
  children,
  ...attachmentOptions
}: PromptInputProviderProps) => {
  // ----- textInput state
  const [textInput, setTextInput] = useState(initialTextInput);
  const clearInput = useCallback(() => setTextInput(""), []);

  // ----- attachments state (global when wrapped)
  const attachments = useAttachments(attachmentOptions);

  const controller = useMemo<PromptInputControllerProps>(
    () => ({
      attachments,
      textInput: {
        clear: clearInput,
        setInput: setTextInput,
        value: textInput,
      },
    }),
    [textInput, clearInput, attachments]
  );

  return (
    <PromptInputController.Provider value={controller}>
      <ProviderAttachmentsContext.Provider value={attachments}>
        {children}
      </ProviderAttachmentsContext.Provider>
    </PromptInputController.Provider>
  );
};

// ============================================================================
// Component Context & Hooks
// ============================================================================

const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null);

export const usePromptInputAttachments = () => {
  // Prefer local context (inside PromptInput), fall back to provider
  const provider = useOptionalProviderAttachments();
  const local = useContext(LocalAttachmentsContext);
  const context = local ?? provider;
  if (!context) {
    throw new Error(
      "usePromptInputAttachments must be used within a PromptInput or PromptInputProvider"
    );
  }
  return context;
};

// ============================================================================
// Referenced Sources (Local to PromptInput)
// ============================================================================

export interface ReferencedSourcesContext {
  sources: (SourceAttachment & { id: string })[];
  add: (sources: SourceAttachment[] | SourceAttachment) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const LocalReferencedSourcesContext =
  createContext<ReferencedSourcesContext | null>(null);

export const usePromptInputReferencedSources = () => {
  const ctx = useContext(LocalReferencedSourcesContext);
  if (!ctx) {
    throw new Error(
      "usePromptInputReferencedSources must be used within a LocalReferencedSourcesContext.Provider"
    );
  }
  return ctx;
};

export type PromptInputActionAddAttachmentsProps = ComponentProps<
  typeof DropdownMenuItem
> & {
  label?: string;
};

export const PromptInputActionAddAttachments = ({
  label = "Add photos or files",
  ...props
}: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments();

  const handleSelect = useCallback(
    (e: Event) => {
      e.preventDefault();
      attachments.openFileDialog();
    },
    [attachments]
  );

  return (
    <DropdownMenuItem {...props} onSelect={handleSelect}>
      <ImageIcon className="mr-2 size-4" /> {label}
    </DropdownMenuItem>
  );
};

export type PromptInputAttachButtonProps = PromptInputButtonProps;

/** The + button in the composer's toolbar: opens the multi-select picker. */
export const PromptInputAttachButton = ({
  children,
  onClick,
  ...props
}: PromptInputAttachButtonProps) => {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      aria-label="Attach files"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) attachments.openFileDialog();
      }}
      {...props}
    >
      {children ?? <PlusIcon className="size-4" />}
    </PromptInputButton>
  );
};

export type PromptInputAttachmentsProps = HTMLAttributes<HTMLDivElement>;

/** The draft's files above the text, with a remove button each, and the refusal lines. */
export const PromptInputAttachments = ({
  className,
  ...props
}: PromptInputAttachmentsProps) => {
  const attachments = usePromptInputAttachments();
  return (
    <div className={cn("order-first w-full px-3", className)} {...props}>
      <AttachmentStrip attachments={attachments} />
    </div>
  );
};

export interface PromptInputMessage {
  text: string;
  /** The message's files, each by reference. */
  files: FileAttachment[];
  /**
   * The same files as `upload` returned them, in the order attached: what a
   * send takes as its `attachments` (`sendAction`, `useHarnessLines().send`).
   */
  attachments: FileContent[];
}

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onError"
> & {
  /**
   * The attachment state, from `useAttachments`, when it is held above the
   * composer: two drawings of one composer pass the same one, so a file
   * attached in either is sent, and cleared, once. Its own options then apply,
   * and `client`, `sessionId`, `accept`, the limits and `onError` here are
   * ignored. Ignored inside a PromptInputProvider, whose own applies.
   */
  attachments?: Attachments;
  /** Where attached files are uploaded. With none, an attached file is refused by name. Ignored inside a PromptInputProvider, whose own applies. */
  client?: AttachmentUploader | null;
  /** The open conversation: a switch drops the draft's files. */
  sessionId?: string | null;
  /** The types the composer takes. Defaults to the attachment limits' image types. */
  accept?: string;
  /** Whether the picker selects several files. Defaults to true. */
  multiple?: boolean;
  globalDrop?: boolean;
  /** No longer needed: the picker is reset after every pick. Kept so existing callers compile. */
  syncHiddenInput?: boolean;
  /** Files of any kind in one message; the per-kind limits apply too. */
  maxFiles?: number;
  /** Bytes in one file, as picked. Defaults to the attachment limits'. */
  maxFileSize?: number;
  onError?: (err: {
    code: "max_files" | "max_file_size" | "accept" | "upload";
    message: string;
  }) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>
  ) => void | Promise<void>;
};

const ERROR_CODES = {
  count: "max_files",
  size: "max_file_size",
  type: "accept",
  upload: "upload",
  unavailable: "upload",
} as const;

export const PromptInput = ({
  attachments,
  client,
  sessionId,
  accept,
  maxFiles,
  maxFileSize,
  onError,
  syncHiddenInput: _syncHiddenInput,
  ...props
}: PromptInputProps) => {
  const controller = useOptionalPromptInputController();
  if (controller) {
    return <PromptInputForm attachments={controller.attachments} controller={controller} {...props} />;
  }
  if (attachments) {
    return <PromptInputForm attachments={attachments} controller={null} {...props} />;
  }
  return (
    <PromptInputOwnAttachments
      options={{
        client,
        sessionId,
        accept,
        limits: { maxFiles, maxFileBytes: maxFileSize },
        onRefused: onError
          ? (refusal) => onError({ code: ERROR_CODES[refusal.code], message: refusal.message })
          : undefined,
      }}
      {...props}
    />
  );
};

type PromptInputFormProps = Omit<
  PromptInputProps,
  "attachments" | "client" | "sessionId" | "accept" | "maxFiles" | "maxFileSize" | "onError" | "syncHiddenInput"
>;

/** A PromptInput outside any provider: the attachment state is its own. */
const PromptInputOwnAttachments = ({
  options,
  ...props
}: PromptInputFormProps & { options: UseAttachmentsOptions }) => {
  const attachments = useAttachments(options);
  return <PromptInputForm attachments={attachments} controller={null} {...props} />;
};

const PromptInputForm = ({
  className,
  attachments,
  controller,
  multiple = true,
  globalDrop,
  onSubmit,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
  ...props
}: PromptInputFormProps & {
  attachments: Attachments;
  controller: PromptInputControllerProps | null;
}) => {
  const formRef = useRef<HTMLFormElement | null>(null);
  // This composer's own picker. The attachment state may be shared by two composers (two drawings of
  // one), and a shared ref would hold one picker, nulled when its composer unmounts.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const own = useMemo<Attachments>(
    () => ({ ...attachments, fileInputRef, openFileDialog: () => fileInputRef.current?.click() }),
    [attachments]
  );
  // Set while a Send waits on uploads and onSubmit, so a second Enter doesn't send the same files again.
  const submittingRef = useRef(false);

  // ----- Local referenced sources (always local to PromptInput)
  const [referencedSources, setReferencedSources] = useState<
    (SourceAttachment & { id: string })[]
  >([]);

  const clearReferencedSources = useCallback(
    () => setReferencedSources([]),
    []
  );

  // Takes files dropped anywhere on the page, when asked to: a native listener, since the document isn't React's.
  const { add } = attachments;
  useEffect(() => {
    if (!globalDrop) {
      return;
    }

    const onDocumentDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDocumentDrop = (e: DragEvent) => {
      // A drop on the form is the form's own.
      if (e.target instanceof Node && formRef.current?.contains(e.target)) {
        return;
      }
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    document.addEventListener("dragover", onDocumentDragOver);
    document.addEventListener("drop", onDocumentDrop);
    return () => {
      document.removeEventListener("dragover", onDocumentDragOver);
      document.removeEventListener("drop", onDocumentDrop);
    };
  }, [add, globalDrop]);

  const refsCtx = useMemo<ReferencedSourcesContext>(
    () => ({
      add: (incoming: SourceAttachment[] | SourceAttachment) => {
        const array = Array.isArray(incoming) ? incoming : [incoming];
        setReferencedSources((prev) => [
          ...prev,
          ...array.map((s) => ({ ...s, id: nanoid() })),
        ]);
      },
      clear: clearReferencedSources,
      remove: (id: string) => {
        setReferencedSources((prev) => prev.filter((s) => s.id !== id));
      },
      sources: referencedSources,
    }),
    [referencedSources, clearReferencedSources]
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      if (submittingRef.current) return;
      submittingRef.current = true;

      const form = event.currentTarget;
      const text = controller
        ? controller.textInput.value
        : (() => {
            const formData = new FormData(form);
            return (formData.get("message") as string) || "";
          })();

      if (!controller) {
        form.reset();
      }

      // Not `take()`: that clears on the spot, and a failed onSubmit must leave the files for a retry.
      // So: settle, then consume only once onSubmit succeeds.
      // The files and refusal lines on screen at Send; one attached or refused while it waits stays.
      const sent = attachments.files.map((f) => f.id);
      const shown = attachments.refusals;
      const clear = () => {
        attachments.consume(sent, shown);
        clearReferencedSources();
        controller?.textInput.clear();
      };

      try {
        // Waits only for uploads still in flight; a file already uploaded is already a reference.
        const uploaded = await attachments.settle();
        const files: FileAttachment[] = uploaded.map((file) => ({
          type: "file",
          mediaType: file.mediaType,
          url: file.data,
          ...(file.filename === undefined ? {} : { filename: file.filename }),
        }));

        const result = onSubmit({ files, attachments: uploaded, text }, event);

        if (result instanceof Promise) {
          try {
            await result;
            clear();
          } catch {
            // Don't clear on error - user may want to retry
          }
        } else {
          clear();
        }
      } catch {
        // Don't clear on error - user may want to retry
      } finally {
        submittingRef.current = false;
      }
    },
    [controller, attachments, onSubmit, clearReferencedSources]
  );

  const { dropTarget } = attachments;
  const inner = (
    <>
      <AttachmentFileInput attachments={own} multiple={multiple} />
      <form
        className={cn("w-full", className)}
        data-dragging={attachments.dragging || undefined}
        onDragEnter={(e) => {
          onDragEnter?.(e);
          dropTarget.onDragEnter(e);
        }}
        onDragLeave={(e) => {
          onDragLeave?.(e);
          dropTarget.onDragLeave(e);
        }}
        onDragOver={(e) => {
          onDragOver?.(e);
          dropTarget.onDragOver(e);
        }}
        onDrop={(e) => {
          onDrop?.(e);
          dropTarget.onDrop(e);
        }}
        onSubmit={handleSubmit}
        ref={formRef}
        {...props}
      >
        <InputGroup
          className={cn(
            "overflow-hidden",
            attachments.dragging && "ring-2 ring-ring"
          )}
        >
          {children}
        </InputGroup>
      </form>
    </>
  );

  const withReferencedSources = (
    <LocalReferencedSourcesContext.Provider value={refsCtx}>
      {inner}
    </LocalReferencedSourcesContext.Provider>
  );

  return (
    <LocalAttachmentsContext.Provider value={own}>
      {withReferencedSources}
    </LocalAttachmentsContext.Provider>
  );
};


export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<
  typeof InputGroupTextarea
>;

export const PromptInputTextarea = ({
  onChange,
  onKeyDown,
  className,
  placeholder = "What would you like to know?",
  ...props
}: PromptInputTextareaProps) => {
  const controller = useOptionalPromptInputController();
  const attachments = usePromptInputAttachments();

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (e) => {
      onKeyDown?.(e);

      if (e.defaultPrevented) {
        return;
      }

      // The one send rule: Enter sends, Shift+Enter is a new line, and an Enter
      // that confirms an input method's word never sends (Safari included).
      if (isSendKey(e, { enterSends: true })) {
        e.preventDefault();

        const { form } = e.currentTarget;
        const submitButton = form?.querySelector(
          'button[type="submit"]'
        ) as HTMLButtonElement | null;
        if (submitButton?.disabled) {
          return;
        }

        form?.requestSubmit();
      }

      if (
        e.key === "Backspace" &&
        e.currentTarget.value === "" &&
        attachments.files.length > 0
      ) {
        e.preventDefault();
        const lastAttachment = attachments.files.at(-1);
        if (lastAttachment) {
          attachments.remove(lastAttachment.id);
        }
      }
    },
    [onKeyDown, attachments]
  );

  const controlledProps = controller
    ? {
        onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
          controller.textInput.setInput(e.currentTarget.value);
          onChange?.(e);
        },
        value: controller.textInput.value,
      }
    : {
        onChange,
      };

  return (
    <InputGroupTextarea
      className={cn("field-sizing-content max-h-48 min-h-16", className)}
      data-testid="message-input"
      name="message"
      onKeyDown={handleKeyDown}
      onPaste={attachments.onPaste}
      placeholder={placeholder}
      {...props}
      {...controlledProps}
    />
  );
};

export type PromptInputHeaderProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputHeader = ({
  className,
  ...props
}: PromptInputHeaderProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("order-first flex-wrap gap-1", className)}
    {...props}
  />
);

export type PromptInputFooterProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputFooter = ({
  className,
  ...props
}: PromptInputFooterProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("justify-between gap-1", className)}
    {...props}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div
    className={cn("flex min-w-0 items-center gap-1", className)}
    {...props}
  />
);

export type PromptInputButtonTooltip =
  | string
  | {
      content: ReactNode;
      shortcut?: string;
      side?: ComponentProps<typeof TooltipContent>["side"];
    };

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton> & {
  tooltip?: PromptInputButtonTooltip;
};

export const PromptInputButton = ({
  variant = "ghost",
  className,
  size,
  tooltip,
  ...props
}: PromptInputButtonProps) => {
  const newSize =
    size ?? (Children.count(props.children) > 1 ? "sm" : "icon-sm");

  const button = (
    <InputGroupButton
      className={cn(className)}
      size={newSize}
      type="button"
      variant={variant}
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  const tooltipContent =
    typeof tooltip === "string" ? tooltip : tooltip.content;
  const shortcut = typeof tooltip === "string" ? undefined : tooltip.shortcut;
  const side = typeof tooltip === "string" ? "top" : (tooltip.side ?? "top");

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={side}>
        {tooltipContent}
        {shortcut && (
          <span className="ml-2 text-muted-foreground">{shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>;
export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => (
  <DropdownMenu {...props} />
);

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps;

export const PromptInputActionMenuTrigger = ({
  className,
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => (
  <DropdownMenuTrigger asChild>
    <PromptInputButton className={className} {...props}>
      {children ?? <PlusIcon className="size-4" />}
    </PromptInputButton>
  </DropdownMenuTrigger>
);

export type PromptInputActionMenuContentProps = ComponentProps<
  typeof DropdownMenuContent
>;
export const PromptInputActionMenuContent = ({
  className,
  ...props
}: PromptInputActionMenuContentProps) => (
  <DropdownMenuContent align="start" className={cn(className)} {...props} />
);

export type PromptInputActionMenuItemProps = ComponentProps<
  typeof DropdownMenuItem
>;
export const PromptInputActionMenuItem = ({
  className,
  ...props
}: PromptInputActionMenuItemProps) => (
  <DropdownMenuItem className={cn(className)} {...props} />
);

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: PromptStatus;
  onStop?: () => void;
};

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon-sm",
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const isGenerating = status === "submitting" || status === "streaming";

  let Icon = <CornerDownLeftIcon className="size-4" />;

  if (status === "submitting") {
    Icon = <Spinner />;
  } else if (status === "streaming") {
    Icon = <SquareIcon className="size-4" />;
  } else if (status === "error") {
    Icon = <XIcon className="size-4" />;
  }

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (isGenerating && onStop) {
        e.preventDefault();
        onStop();
        return;
      }
      onClick?.(e);
    },
    [isGenerating, onStop, onClick]
  );

  return (
    <InputGroupButton
      aria-label={isGenerating ? "Stop" : "Submit"}
      className={cn(className)}
      data-testid="message-submit"
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? "button" : "submit"}
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  );
};

export type PromptInputSelectProps = ComponentProps<typeof Select>;

export const PromptInputSelect = (props: PromptInputSelectProps) => (
  <Select {...props} />
);

export type PromptInputSelectTriggerProps = ComponentProps<
  typeof SelectTrigger
>;

export const PromptInputSelectTrigger = ({
  className,
  ...props
}: PromptInputSelectTriggerProps) => (
  <SelectTrigger
    className={cn(
      "border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors",
      "hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
      className
    )}
    {...props}
  />
);

export type PromptInputSelectContentProps = ComponentProps<
  typeof SelectContent
>;

export const PromptInputSelectContent = ({
  className,
  ...props
}: PromptInputSelectContentProps) => (
  <SelectContent className={cn(className)} {...props} />
);

export type PromptInputSelectItemProps = ComponentProps<typeof SelectItem>;

export const PromptInputSelectItem = ({
  className,
  ...props
}: PromptInputSelectItemProps) => (
  <SelectItem className={cn(className)} {...props} />
);

export type PromptInputSelectValueProps = ComponentProps<typeof SelectValue>;

export const PromptInputSelectValue = ({
  className,
  ...props
}: PromptInputSelectValueProps) => (
  <SelectValue className={cn(className)} {...props} />
);

export type PromptInputHoverCardProps = ComponentProps<typeof HoverCard>;

export const PromptInputHoverCard = ({
  openDelay = 0,
  closeDelay = 0,
  ...props
}: PromptInputHoverCardProps) => (
  <HoverCard closeDelay={closeDelay} openDelay={openDelay} {...props} />
);

export type PromptInputHoverCardTriggerProps = ComponentProps<
  typeof HoverCardTrigger
>;

export const PromptInputHoverCardTrigger = (
  props: PromptInputHoverCardTriggerProps
) => <HoverCardTrigger {...props} />;

export type PromptInputHoverCardContentProps = ComponentProps<
  typeof HoverCardContent
>;

export const PromptInputHoverCardContent = ({
  align = "start",
  ...props
}: PromptInputHoverCardContentProps) => (
  <HoverCardContent align={align} {...props} />
);

export type PromptInputTabsListProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTabsList = ({
  className,
  ...props
}: PromptInputTabsListProps) => <div className={cn(className)} {...props} />;

export type PromptInputTabProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTab = ({
  className,
  ...props
}: PromptInputTabProps) => <div className={cn(className)} {...props} />;

export type PromptInputTabLabelProps = HTMLAttributes<HTMLHeadingElement>;

export const PromptInputTabLabel = ({
  className,
  ...props
}: PromptInputTabLabelProps) => (
  <h3
    className={cn(
      "mb-2 px-3 font-medium text-muted-foreground text-xs",
      className
    )}
    {...props}
  />
);

export type PromptInputTabBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTabBody = ({
  className,
  ...props
}: PromptInputTabBodyProps) => (
  <div className={cn("space-y-1", className)} {...props} />
);

export type PromptInputTabItemProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTabItem = ({
  className,
  ...props
}: PromptInputTabItemProps) => (
  <div
    className={cn(
      "flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent",
      className
    )}
    {...props}
  />
);

export type PromptInputCommandProps = ComponentProps<typeof Command>;

export const PromptInputCommand = ({
  className,
  ...props
}: PromptInputCommandProps) => <Command className={cn(className)} {...props} />;

export type PromptInputCommandInputProps = ComponentProps<typeof CommandInput>;

export const PromptInputCommandInput = ({
  className,
  ...props
}: PromptInputCommandInputProps) => (
  <CommandInput className={cn(className)} {...props} />
);

export type PromptInputCommandListProps = ComponentProps<typeof CommandList>;

export const PromptInputCommandList = ({
  className,
  ...props
}: PromptInputCommandListProps) => (
  <CommandList className={cn(className)} {...props} />
);

export type PromptInputCommandEmptyProps = ComponentProps<typeof CommandEmpty>;

export const PromptInputCommandEmpty = ({
  className,
  ...props
}: PromptInputCommandEmptyProps) => (
  <CommandEmpty className={cn(className)} {...props} />
);

export type PromptInputCommandGroupProps = ComponentProps<typeof CommandGroup>;

export const PromptInputCommandGroup = ({
  className,
  ...props
}: PromptInputCommandGroupProps) => (
  <CommandGroup className={cn(className)} {...props} />
);

export type PromptInputCommandItemProps = ComponentProps<typeof CommandItem>;

export const PromptInputCommandItem = ({
  className,
  ...props
}: PromptInputCommandItemProps) => (
  <CommandItem className={cn(className)} {...props} />
);

export type PromptInputCommandSeparatorProps = ComponentProps<
  typeof CommandSeparator
>;

export const PromptInputCommandSeparator = ({
  className,
  ...props
}: PromptInputCommandSeparatorProps) => (
  <CommandSeparator className={cn(className)} {...props} />
);
