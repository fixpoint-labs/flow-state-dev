import { useState } from "react";
import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import CodeBlock from "@theme/CodeBlock";

import styles from "./index.module.css";

/* ── Code examples ── */

const defineExample = `import { defineFlow, generator, sequencer } from "@flow-state-dev/core";
// Reusable blocks — yours, your team's, or from the ecosystem
import { searchWeb, searchInternalDocs, searchMemory } from "@research/blocks";
import { mergeAndRank, refineResults } from "@research/ranking";
import { gatherEvidence, scoreFindings } from "@research/analysis";
import { logAnalytics, fallbackSearch } from "@infra/blocks";

// A tool that's a full pipeline — parallel search, iterative refinement, recovery
const deepResearch = sequencer({ name: "deep-research" })
  .then(parseQuery)
  .parallel({ // fan out to three sources at once
    web: searchWeb,
    docs: searchInternalDocs,
    memory: searchMemory,
  }, { maxConcurrency: 3 })
  .then(mergeAndRank)
  .doUntil( // loop until quality threshold met
    (result) => result.confidence > 0.9,
    refineResults
  )
  .work(logAnalytics) // async — doesn't block the pipeline
  .rescue([{ when: [SearchError], block: fallbackSearch }]);

// Sequencer that analyzes and emits a component item to the UI
const analyze = sequencer({ name: "analyze" })
  .then(gatherEvidence)
  .then(scoreFindings)
  .tap((report, ctx) => { // emit without changing the payload
    ctx.emitComponent("report-card", {
      title: report.title,
      findings: report.findings,
      confidence: report.score,
    }).done();
  });

const agent = generator({
  name: "agent",
  model: "gpt-5-mini",
  prompt: "You are a research assistant.",
  // Blocks can declare only the state they need
  sessionStateSchema: z.object({ researchCount: z.number().default(0) }),
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
  tools: [deepResearch, analyze, readDoc, writeDoc],
});

export default defineFlow({
  kind: "research-assistant",
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: agent,
      userMessage: (i) => i.message,
    },
  },
  session: {
    stateSchema,
    resources: { docs: docResource },
    projections: {
      docList: { client: true, compute: (ctx) => /* derived view */ },
    },
  },
})({ id: "default" });`;

const serveExample = `import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import researchFlow from "./flows/research-assistant";
import chatFlow from "./flows/chat";

const registry = createFlowRegistry();
registry.register(researchFlow);
registry.register(chatFlow);

export const { GET, POST, DELETE } = createFlowApiRouter({ registry });
// POST /api/flows/research-assistant/actions/chat
// GET  /api/flows/research-assistant/requests/:id/stream
// GET  /api/flows/sessions/:id/state`;

const renderExample = `// Register component renderers — the UI counterpart to ctx.emitComponent()
function ReportCard({ item }: { item: ComponentItem }) {
  const { title, findings, confidence } = item.data;
  return (
    <div className="report-card">
      <h3>{title}</h3>
      <ul>{findings.map(f => <li key={f}>{f}</li>)}</ul>
      <meter value={confidence} />
    </div>
  );
}

function App() {
  return (
    <FlowProvider
      flowKind="research-assistant"
      userId="user_1"
      baseUrl="/api"
      renderers={{ component: { "report-card": ReportCard } }}
    >
      <ResearchApp />
    </FlowProvider>
  );
}

function ResearchApp() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  return (
    <>
      {/* ItemRenderer resolves component items to registered renderers */}
      {session.items.map(item => <ItemRenderer key={item.id} item={item} />)}

      <button
        onClick={() => session.sendAction("chat", { message: "Hello" })}
        disabled={session.isStreaming}
      >
        {session.isStreaming ? "Researching..." : "Send"}
      </button>
    </>
  );
}`;

const testExample = `const result = await testFlow({
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

const items = testItems(result.items);
expect(items.messages()).not.toHaveLength(0);
expect(items.components("report-card")).not.toHaveLength(0);`;

/* ── Data ── */

type CodeTab = {
  label: string;
  caption: string;
  code: string;
  language: string;
};

const codeTabs: CodeTab[] = [
  {
    label: "Define",
    caption: "Compose blocks into flows with typed state, resources, and projections.",
    code: defineExample,
    language: "ts",
  },
  {
    label: "Serve",
    caption: "Register flows and get a full REST + SSE API. No route wiring.",
    code: serveExample,
    language: "ts",
  },
  {
    label: "Render",
    caption: "Register component renderers. ItemRenderer resolves them from the stream.",
    code: renderExample,
    language: "tsx",
  },
  {
    label: "Test",
    caption: "Deterministic tests with mock generators. No LLM calls needed.",
    code: testExample,
    language: "ts",
  },
];

type FeatureItem = {
  title: string;
  description: string;
  icon: string;
};

const features: FeatureItem[] = [
  {
    title: "Four primitives. Compose freely.",
    description:
      "Handler, generator, sequencer, router. The sequencer DSL alone gives you parallel steps, forEach, doUntil/doWhile loops, background work, branching, error recovery, and more.",
    icon: "\u25E3",
  },
  {
    title: "Flows are full APIs.",
    description:
      "Define a flow and you have REST endpoints, SSE streaming, session management, and state snapshots. No route wiring.",
    icon: "\u21C4",
  },
  {
    title: "Hybrid memory + filesystem.",
    description:
      "Resources combine rich text with structured state \u2014 like files that carry metadata. Scoped to sessions, users, or projects.",
    icon: "\u2B22",
  },
  {
    title: "Built for an ecosystem.",
    description:
      "Blocks are portable. Share a tool, a handler, or an entire flow. Community blocks compose with yours out of the box.",
    icon: "\u2B2C",
  },
  {
    title: "Streaming that just works.",
    description:
      "Messages, components, status updates \u2014 all stream over SSE as blocks execute. Disconnect mid-response? Reconnect with a sequence cursor.",
    icon: "\u2192",
  },
  {
    title: "Type-safe, end to end.",
    description:
      "One Zod schema flows from server blocks through client SDK to React hooks. No glue code. No type drift.",
    icon: "\u2B25",
  },
];

/* ── Components ── */

function Hero() {
  return (
    <header className={styles.heroBanner}>
      <div className={styles.heroGrid} />
      <div className={`container ${styles.heroContent}`}>
        <div className={styles.heroAccent} />
        <Heading as="h1" className={styles.heroTitle}>
          Stop wiring.{"\n"}Start building.
        </Heading>
        <p className={styles.heroSubtitle}>
          <span className={styles.brandName}>flow-state.dev</span> gives you
          composable primitives for AI orchestration, streaming, state, and
          error handling &mdash; so you can explore new patterns instead of
          reinventing infrastructure.
        </p>
        <div className={styles.buttons}>
          <Link className={styles.primaryBtn} to="/docs/getting-started/quick-start">
            Get Started
          </Link>
          <Link className={styles.secondaryBtn} to="/docs/intro">
            Why flow-state.dev?
          </Link>
        </div>
      </div>
    </header>
  );
}

function Features() {
  return (
    <section className={styles.features}>
      <div className={styles.featuresSectionHeader}>
        <div>
          <span className={styles.featuresSectionLabel}>Primitives</span>
        </div>
        <Heading as="h2" className={styles.featuresSectionTitle}>
          Everything you need, nothing you don't
        </Heading>
        <p className={styles.featuresSectionSubtext}>
          Four block kinds, composable flows, and scoped state. Each piece works alone or together.
        </p>
      </div>
      <div className={styles.featureGrid}>
        {features.map((f, i) => (
          <div key={i} className={styles.featureCard}>
            <div className={styles.featureNumber}>0{i + 1}</div>
            <div className={styles.featureTitle}>{f.title}</div>
            <p className={styles.featureDesc}>{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CodeShowcase() {
  const [active, setActive] = useState(0);
  const tab = codeTabs[active];

  return (
    <section className={styles.codeShowcase}>
      <div style={{ textAlign: "center" }}>
        <span className={styles.sectionLabel}>Workflow</span>
      </div>
      <Heading as="h2" className={styles.sectionTitle}>
        From definition to UI in four steps
      </Heading>
      <p className={styles.sectionSubtext}>
        Define blocks. Register flows. Wire up React. Write deterministic tests.
        Each layer is independent and composable.
      </p>

      <div className={styles.tabBar}>
        {codeTabs.map((t, i) => (
          <button
            key={i}
            className={`${styles.tab} ${i === active ? styles.tabActive : ""}`}
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.codeWrapper}>
        <CodeBlock language={tab.language}>{tab.code}</CodeBlock>
      </div>
      <p className={styles.codeCaption}>{tab.caption}</p>
    </section>
  );
}

function InstallSnippet() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText("npx create-flow-state-app my-app");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button className={styles.installSnippet} onClick={handleCopy} type="button">
      <span className={styles.installPrompt}>$</span>
      npx create-flow-state-app my-app
      <span className={styles.installCopy}>{copied ? "copied!" : "click to copy"}</span>
    </button>
  );
}

function CTA() {
  return (
    <section className={styles.ctaSection}>
      <div className={styles.ctaContent}>
        <Heading as="h2" className={styles.ctaTitle}>
          Ready to explore?
        </Heading>
        <p className={styles.ctaSubtext}>
          Get a streaming AI app running in minutes. Then push it somewhere no
          framework has gone before.
        </p>
        <div className={styles.buttons}>
          <Link className={styles.primaryBtn} to="/docs/getting-started/quick-start">
            Quick Start
          </Link>
          <Link className={styles.secondaryBtn} to="/blog/welcome">
            Read the Manifesto
          </Link>
        </div>
        <InstallSnippet />
      </div>
    </section>
  );
}

/* ── Page ── */

export default function Home(): React.ReactElement {
  return (
    <Layout
      title="AI workflows, composed"
      description="flow-state.dev \u2014 a TypeScript framework for building AI workflows with composable blocks, resumable streaming, scoped state, and full-stack type safety."
    >
      <Hero />
      <main>
        <div className={styles.sectionDivider} />
        <Features />
        <div className={styles.sectionDivider} />
        <CodeShowcase />
        <div className={styles.sectionDivider} />
        <CTA />
      </main>
    </Layout>
  );
}
