/**
 * Test seam — minimal mocks for unit-testing flows that consume the
 * chat capability or utility blocks without instantiating a real Chat
 * SDK bot. Exported under `@flow-state-dev/chat-sdk/testing` so
 * production code never pulls in the seam.
 *
 * The mocks satisfy the shapes the package's own modules read: enough
 * of `Thread` / `Message` to drive the capability methods and the
 * utility blocks. They are deliberately untyped against the upstream
 * `chat` package — full type fidelity would require constructing real
 * adapters, which is the point this seam avoids.
 */
import { setThreadForRequest, clearThreadForRequest } from "./thread-registry";

export interface MockChatThread {
  id: string;
  isDM: boolean;
  /**
   * Adapter surface used by the utility blocks. `addReaction` is required
   * because `chatReact` calls `thread.adapter.addReaction(...)` on the
   * inbound message.
   */
  adapter: {
    name: string;
    addReaction: (
      threadId: string,
      messageId: string,
      emoji: string
    ) => Promise<void>;
  };
  posts: unknown[];
  typings: Array<string | undefined>;
  reactions: Array<{ threadId: string; messageId: string; emoji: string }>;
  post: (body: unknown) => Promise<{ id: string; edit: (b: unknown) => Promise<void> }>;
  startTyping: (label?: string) => Promise<void>;
  setState: (partial: unknown, opts?: { replace?: boolean }) => Promise<void>;
  getParticipants: () => Promise<unknown[]>;
}

/**
 * Mirrors the production `Message` shape the package reads: `id`,
 * `threadId`, `text`, and `author.userId`. The earlier `author.id` shape
 * silently masked the principal-resolution branch since production reads
 * `author.userId`.
 */
export interface MockChatMessage {
  id: string;
  threadId: string;
  text: string;
  author: { userId: string };
}

export function createMockThread(
  overrides: Partial<MockChatThread> = {}
): MockChatThread {
  const posts: unknown[] = [];
  const typings: Array<string | undefined> = [];
  const reactions: Array<{ threadId: string; messageId: string; emoji: string }> = [];
  return {
    id: overrides.id ?? "slack:C123:1234567890.123456",
    isDM: overrides.isDM ?? false,
    adapter: overrides.adapter ?? {
      name: "slack",
      async addReaction(threadId, messageId, emoji) {
        reactions.push({ threadId, messageId, emoji });
      },
    },
    posts,
    typings,
    reactions,
    async post(body) {
      // Drain async iterables so streaming tests see all chunks.
      if (body !== null && typeof body === "object" && Symbol.asyncIterator in body) {
        const collected: string[] = [];
        for await (const chunk of body as AsyncIterable<string>) collected.push(chunk);
        posts.push(collected.join(""));
      } else {
        posts.push(body);
      }
      return {
        id: `m_${posts.length}`,
        edit: async (next: unknown) => {
          posts.push({ edit: next });
        },
      };
    },
    async startTyping(label) {
      typings.push(label);
    },
    async setState() {},
    async getParticipants() {
      return [];
    },
    ...overrides,
  } as MockChatThread;
}

export function createMockMessage(
  overrides: Partial<MockChatMessage> = {}
): MockChatMessage {
  return {
    id: overrides.id ?? "m_inbound",
    threadId: overrides.threadId ?? "slack:C123:1234567890.123456",
    text: overrides.text ?? "",
    author: overrides.author ?? { userId: "U_USER" },
    ...overrides,
  };
}

/**
 * Bind a mock thread+message to a synthesized `requestId` so capability
 * methods and utility blocks read live values in tests. Returns the
 * `requestId` and a cleanup function.
 */
export function withChatContext(args: {
  requestId?: string;
  thread?: MockChatThread;
  message?: MockChatMessage;
}): { requestId: string; cleanup: () => void } {
  const requestId = args.requestId ?? `req_${Math.random().toString(36).slice(2)}`;
  const thread = args.thread ?? createMockThread();
  const message = args.message ?? createMockMessage();
  setThreadForRequest(requestId, thread as unknown as never, message as unknown as never);
  return {
    requestId,
    cleanup: () => clearThreadForRequest(requestId),
  };
}
