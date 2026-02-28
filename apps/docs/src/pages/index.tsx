import clsx from "clsx";
import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import CodeBlock from "@theme/CodeBlock";

import styles from "./index.module.css";

function HomepageHeader() {
  return (
    <header className={clsx("hero", styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className={styles.heroTitle}>
          Stop wiring. Start building.
        </Heading>
        <p className={styles.heroSubtitle}>
          Flow State Dev is a TypeScript framework that turns AI orchestration,
          streaming, state, and error handling into composable primitives —
          so you can focus on what your AI actually does.
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--primary button--lg"
            to="/docs/getting-started/quick-start"
          >
            Get Started
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro"
          >
            Why Flow State Dev?
          </Link>
        </div>
      </div>
    </header>
  );
}

const defineFlowExample = `import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";

// An LLM-powered chat with conversation history and tools
const chat = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
  tools: [searchDocs, createArtifact],
});

// Track usage with atomic state operations
const trackUsage = handler({
  name: "track-usage",
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ messageCount: 1 });
    return input;
  },
});

// Compose into a pipeline with error recovery
const pipeline = sequencer({ name: "chat-pipeline" })
  .then(chat)
  .then(trackUsage)
  .rescue([{ when: [ModelError], block: fallback }]);

// Define the flow — streaming, state, retries all handled
export default defineFlow({
  kind: "my-app",
  actions: {
    chat: { block: pipeline, userMessage: (i) => i.message },
  },
  session: { stateSchema, resources, projections },
})({ id: "default" });`;

const serverExample = `import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import myFlow from "./flows/my-flow";

const registry = createFlowRegistry();
registry.register(myFlow);

export const { GET, POST, DELETE } = createFlowApiRouter({ registry });
// That's it. Full REST API with SSE streaming.`;

const reactExample = `function Chat() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);
  const { session: proj } = useProjections(session, {
    session: ["messageCount"],
  });

  return (
    <>
      {session.items.map(item => <ItemRenderer key={item.id} item={item} />)}
      <span>{proj?.messageCount} messages</span>
      <button
        onClick={() => session.sendAction("chat", { message: "Hello" })}
        disabled={session.isStreaming}
      >
        {session.isStreaming ? "Thinking..." : "Send"}
      </button>
    </>
  );
}`;

const testExample = `const result = await testBlock(pipeline, {
  input: { message: "Hello" },
  session: { state: { messageCount: 0 } },
  generators: {
    chat: mockGenerator({ script: [{ text: "Hi there!" }] }),
  },
});

expect(result.items).toContainItemOfType("message");
expect(result.session.state.messageCount).toBe(1);`;

type FeatureItem = {
  title: string;
  description: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: "Four primitives. Infinite compositions.",
    description:
      "Handler, generator, sequencer, router — every AI workflow reduces to these four blocks. Compose them into pipelines with branching, parallelism, loops, and error recovery using a fluent DSL.",
  },
  {
    title: "Streaming that just works.",
    description:
      "Items stream over SSE as blocks execute — messages, tool calls, state changes, custom components. Disconnect mid-response? Reconnect with a sequence cursor. No data loss. No duplicates.",
  },
  {
    title: "State that scales with your app.",
    description:
      "Four isolation levels — request, session, user, project — each with atomic operations. Resources hold structured data. Projections are the only way to expose state to clients. Security by architecture.",
  },
  {
    title: "Type safety from schema to screen.",
    description:
      "Define a Zod schema once. It validates at runtime, infers at compile time, and flows from server blocks through the client SDK to React hooks. No glue code. No type drift.",
  },
];

function Feature({ title, description }: FeatureItem) {
  return (
    <div className={clsx("col col--6")}>
      <div className="padding-horiz--md padding-vert--lg">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

type CodeTab = {
  label: string;
  code: string;
  language: string;
};

const codeTabs: CodeTab[] = [
  { label: "Define", code: defineFlowExample, language: "ts" },
  { label: "Serve", code: serverExample, language: "ts" },
  { label: "Render", code: reactExample, language: "tsx" },
  { label: "Test", code: testExample, language: "ts" },
];

function HomepageCodeShowcase() {
  return (
    <section className={styles.codeShowcase}>
      <div className="container">
        <div className="row">
          <div className="col col--10 col--offset-1">
            <Heading as="h2" className="text--center margin-bottom--sm">
              From definition to UI in four steps
            </Heading>
            <p className={clsx("text--center margin-bottom--lg", styles.sectionSubtext)}>
              Define your blocks and flows. Register with the server. Wire up React hooks. Write deterministic tests. Each layer is independent and composable.
            </p>
            {codeTabs.map((tab, idx) => (
              <div key={idx} className={styles.codeStep}>
                <div className={styles.codeStepLabel}>
                  <span className={styles.codeStepNumber}>{idx + 1}</span>
                  {tab.label}
                </div>
                <CodeBlock language={tab.language}>{tab.code}</CodeBlock>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HomepageCTA() {
  return (
    <section className={styles.ctaSection}>
      <div className="container text--center">
        <Heading as="h2">Ready to build?</Heading>
        <p className={styles.sectionSubtext} style={{ margin: "0 auto 1.5rem" }}>
          Get a streaming chat app running in under 5 minutes. No boilerplate. No plumbing.
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--primary button--lg"
            to="/docs/getting-started/quick-start"
          >
            Quick Start Guide
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): React.ReactElement {
  return (
    <Layout
      title="AI workflows, composed"
      description="Flow State Dev — a TypeScript framework for building AI workflows with composable blocks, resumable streaming, scoped state, and full-stack type safety."
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <HomepageCodeShowcase />
        <HomepageCTA />
      </main>
    </Layout>
  );
}
