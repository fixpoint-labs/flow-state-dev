import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";

import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started/quick-start"
          >
            Get Started
          </Link>
          <Link
            className="button button--secondary button--outline button--lg"
            to="/docs/intro"
            style={{ marginLeft: "1rem" }}
          >
            Learn More
          </Link>
        </div>
      </div>
    </header>
  );
}

type FeatureItem = {
  title: string;
  description: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: "Typed Blocks, Composable Flows",
    description:
      "Define handlers, generators, sequencers, and routers as typed building blocks. Compose them into flows with a fluent DSL that catches errors at build time.",
  },
  {
    title: "Resumable Streaming",
    description:
      "Item-first streaming with sequence-number replay. Clients reconnect mid-stream without losing data. SSE protocol with content deltas, tool calls, and status events.",
  },
  {
    title: "Scoped State Management",
    description:
      "Four scope levels — request, session, user, project — with CAS-based state operations. Resources and projections provide typed data management with client visibility control.",
  },
  {
    title: "Full-Stack TypeScript",
    description:
      "One type system from server execution through client transport to React UI. Schemas defined once, validated everywhere. No glue code between layers.",
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

function HomepageCodePreview() {
  return (
    <section className={styles.codePreview}>
      <div className="container">
        <div className="row">
          <div className="col col--8 col--offset-2">
            <Heading as="h2" className="text--center margin-bottom--lg">
              Define a flow in minutes
            </Heading>
            <pre className={styles.codeBlock}>
              <code>{`import { defineFlow, generator, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const chatGen = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});

const pipeline = sequencer({
  name: "chat-pipeline",
  inputSchema: z.object({ message: z.string() }),
}).then(chatGen);

export default defineFlow({
  kind: "my-chat",
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: pipeline,
      userMessage: (input) => input.message,
    },
  },
});`}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home(): React.ReactElement {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <HomepageCodePreview />
      </main>
    </Layout>
  );
}
