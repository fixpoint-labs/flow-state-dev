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
          <span className={styles.brandName}>flow-state.dev</span> is a TypeScript framework that turns AI orchestration,
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
            Why flow-state.dev?
          </Link>
        </div>
      </div>
    </header>
  );
}

const defineFlowExample = `import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";

// Any block or sequence of blocks can be used as a tool.
// This tool is a full multi-step pipeline.
const deepResearch = sequencer({ name: "deep-research" })
  .then(searchIndex)
  .then(rankResults)
  .then(summarize);

// Resources give your AI a persistent workspace: text + structured state
// Think files with metadata, scoped to sessions, users, or projects.
const docResource = {
  stateSchema: z.object({
    byId: z.record(z.object({
      title: z.string(),
      content: z.string(),       // Rich text — the "file" part
      tags: z.array(z.string()), // Structured state — the "metadata" part
    })).default({}),
    order: z.array(z.string()).default([]),
  }),
  writable: true,
};

// Pass any block as a tool — the framework compiles it for the LLM
const agent = generator({
  name: "agent",
  model: "gpt-5-mini",
  prompt: "You are a research assistant.",
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
  tools: [deepResearch, readDoc, writeDoc],
});

// Define the flow — this becomes a full API instantly
export default defineFlow({
  kind: "research-assistant",
  actions: {
    chat: { block: agent, userMessage: (i) => i.message },
  },
  session: {
    stateSchema,
    resources: { docs: docResource },
    projections: {
      docList: { client: true, compute: (ctx) => /* derived view */ },
    },
  },
})({ id: "default" });`;

const serverExample = `import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import researchFlow from "./flows/research-assistant";
import chatFlow from "./flows/chat";

const registry = createFlowRegistry();
registry.register(researchFlow);
registry.register(chatFlow);  // Register as many flows as you need

export const { GET, POST, DELETE } = createFlowApiRouter({ registry });
// Each flow is now a full API: actions, sessions, streaming, state snapshots.
// POST /api/flows/research-assistant/actions/chat
// GET  /api/flows/research-assistant/requests/:id/stream
// GET  /api/flows/sessions/:id/state`;

const reactExample = `function ResearchApp() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  // Projections derive client-safe views from server-side resources
  const { session: proj } = useProjections(session, {
    session: ["docList"],
  });

  return (
    <>
      {/* Items stream in real time as the AI works */}
      {session.items.map(item => <ItemRenderer key={item.id} item={item} />)}

      {/* Projection: derived from resource state, updated after each request */}
      <aside>
        <h3>Documents ({proj?.docList?.length ?? 0})</h3>
        {proj?.docList?.map(doc => <DocCard key={doc.id} {...doc} />)}
      </aside>

      <button
        onClick={() => session.sendAction("chat", { message: "Hello" })}
        disabled={session.isStreaming}
      >
        {session.isStreaming ? "Researching..." : "Send"}
      </button>
    </>
  );
}`;

const testExample = `// Deterministic tests — no real LLM calls, no network
const result = await testFlow({
  flow: researchFlow,
  action: "chat",
  input: { message: "Summarize the design doc" },
  userId: "testuser",
  seed: {
    session: {
      resources: {
        docs: { byId: { "design-doc": { title: "Design", content: "..." } } },
      },
    },
  },
  generators: {
    agent: mockGenerator({ script: [{ text: "The design doc covers..." }] }),
  },
});

expect(result.items).toContainItemOfType("message");
expect(result.items).toContainItemOfType("tool_call");`;

type FeatureItem = {
  title: string;
  description: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: "Four primitives. Compose freely.",
    description:
      "Handler, generator, sequencer, router — every AI workflow reduces to these four blocks. Any block or sequence of blocks can be used as a tool, so a single tool call can trigger an entire pipeline. Compose freely with branching, parallelism, loops, and error recovery.",
  },
  {
    title: "Flows are full APIs.",
    description:
      "Define a flow, register it, and you have a complete REST API with SSE streaming, session management, and state snapshots. No route wiring. No transport plumbing. Every flow is instantly callable from any client.",
  },
  {
    title: "Resources: hybrid memory + filesystem.",
    description:
      "Resources combine rich text content with atomic structured state — like files that carry metadata. Scoped to sessions, users, or projects. Projections derive client-safe views. Your AI gets a persistent, typed workspace.",
  },
  {
    title: "Built for an ecosystem.",
    description:
      "Blocks and flows are portable by design. Share a tool block, a validation handler, or an entire flow across projects. The uniform block contract means community blocks compose with yours out of the box.",
  },
  {
    title: "Streaming that just works.",
    description:
      "Items stream over SSE as blocks execute — messages, tool calls, state changes, custom components. Disconnect mid-response? Reconnect with a sequence cursor. No data loss. No duplicates.",
  },
  {
    title: "Type safety from schema to screen.",
    description:
      "Define a Zod schema once. It validates at runtime, infers at compile time, and flows from server blocks through the client SDK to React hooks. No glue code. No type drift.",
  },
];

function Feature({ title, description }: FeatureItem) {
  return (
    <div className={clsx("col col--4")}>
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
      description="flow-state.dev — a TypeScript framework for building AI workflows with composable blocks, resumable streaming, scoped state, and full-stack type safety."
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
