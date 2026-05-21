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
  adapter: { name: string };
  posts: unknown[];
  typings: Array<string | undefined>;
  post: (body: unknown) => Promise<{ id: string; edit: (b: unknown) => Promise<void> }>;
  startTyping: (label?: string) => Promise<void>;
  setState: (partial: unknown, opts?: { replace?: boolean }) => Promise<void>;
  getParticipants: () => Promise<unknown[]>;
}

export interface MockChatMessage {
  id: string;
  text: string;
  author: { id: string };
  addReaction: (emoji: string) => Promise<void>;
  reactions: string[];
}

export function createMockThread(
  overrides: Partial<MockChatThread> = {}
): MockChatThread {
  const posts: unknown[] = [];
  const typings: Array<string | undefined> = [];
  return {
    id: overrides.id ?? "slack:C123:1234567890.123456",
    isDM: overrides.isDM ?? false,
    adapter: overrides.adapter ?? { name: "slack" },
    posts,
    typings,
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
  const reactions: string[] = [];
  return {
    id: overrides.id ?? "m_inbound",
    text: overrides.text ?? "",
    author: overrides.author ?? { id: "U_USER" },
    reactions,
    async addReaction(emoji) {
      reactions.push(emoji);
    },
    ...overrides,
  } as MockChatMessage;
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
