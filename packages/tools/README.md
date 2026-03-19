# @flow-state-dev/tools

Portable tool blocks for `@flow-state-dev` flows. Each tool is a handler block that can be passed directly to a generator's `tools` array.

## Search

Multi-provider web search with automatic provider detection.

```typescript
import { search } from "@flow-state-dev/tools/search";

const webSearch = search(); // auto-detects from env vars

generator({
  tools: [webSearch],
  // ...
});
```

### Providers

Provider is selected automatically based on available API keys (checked in order):

| Provider | Env var | Package |
|----------|---------|---------|
| Tavily | `TAVILY_API_KEY` | `@tavily/core` (optional peer dep) |
| Exa | `EXA_API_KEY` | `exa-js` (optional peer dep) |
| Serper | `SERPER_API_KEY` | _(fetch-based, no extra dep)_ |
| Brave | `BRAVE_API_KEY` | _(fetch-based, no extra dep)_ |

### Configuration

```typescript
search({
  provider: "tavily",        // override auto-detection
  maxResults: 10,            // default: 5
  searchDepth: "advanced",   // "basic" (default) or "advanced"
  topic: "news",             // "general" (default) or "news"
  keys: { tavily: "sk-..." }, // explicit keys (default: env vars)
});
```

### Direct provider constructors

```typescript
import { tavilySearch, exaSearch, serperSearch, braveSearch } from "@flow-state-dev/tools/search";
```

## Provider-native search

For provider-level search tools (grounded responses, citations), use the `search` field on generator config instead:

```typescript
generator({
  search: true, // uses the model provider's native search tool
});
```

See `@flow-state-dev/core` generator docs for details.
