/**
 * The one send shortcut every message box shares. Cmd+Enter on a Mac and
 * Ctrl+Enter elsewhere send from any box, whatever plain Enter does there, so a
 * person never has to reach for the button. Plain Enter sends only in a box
 * that says so (`enterSends`, a chat composer); in a box for a longer answer
 * it stays a new line. Shift+Enter is always a new line, and an Enter that
 * confirms an input method's composition (CJK and the like) never sends.
 */

/** The parts of a keystroke the shortcut reads: a React or a DOM `KeyboardEvent` both fit. */
export type SendKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
};

export type SendKeyOptions = {
  /** Plain Enter sends too, as in a chat composer. Off by default: Enter is a new line. */
  enterSends?: boolean;
};

/**
 * Whether `event` asks the box to send. Call `preventDefault()` and send when
 * it does; leave the keystroke alone when it doesn't.
 */
export function isSendKey(event: SendKeyEvent, options: SendKeyOptions = {}): boolean {
  if (event.key !== "Enter" || event.shiftKey) return false;
  // Safari fires the Enter that ends a composition after compositionend, so isComposing is false there; keyCode 229 still marks it.
  if (event.isComposing === true || event.nativeEvent?.isComposing === true || event.keyCode === 229) return false;
  if (event.metaKey || event.ctrlKey) return true;
  return options.enterSends === true;
}

/**
 * Whether a key pressed on `target` is typing: in a text field, a text area, a
 * select or editable text. A page-wide shortcut that is a printable key (`/`,
 * `?`, `[`) leaves such a key to the field.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}
