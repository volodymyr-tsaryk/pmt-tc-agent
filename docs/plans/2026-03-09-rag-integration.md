# RAG Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect the existing `searchDocsTool` / `searchCodeTool` stubs to a real vector store so the TaskAnalyzer agent can retrieve relevant project documentation and codebase context before writing a Development Plan.

**Architecture:** An ingestion CLI script reads files from paths defined in `ProjectConfig.knowledge`, chunks and embeds them using `@mastra/rag`, and stores vectors in a local LibSQL (SQLite) vector store. At analysis time, when `knowledge.enabled = true`, the agent receives the two RAG tools and is instructed to search before planning. Results are returned as ranked text chunks with source filenames.

**Tech Stack:** `@mastra/rag`, `@mastra/vector-libsql` (local SQLite), `@ai-sdk/openai` (embeddings via `text-embedding-3-small`), existing Mastra + Express stack.

---

## Overview of Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Install dependencies | `package.json` |
| 2 | Create vector store singleton | `src/store/vector-store.ts` |
| 3 | Implement ingestion script | `scripts/ingest-knowledge.ts` |
| 4 | Implement RAG tools | `src/mastra/tools/rag.ts` |
| 5 | Wire tools into agent | `src/mastra/agents/task-analyzer.ts` |
| 6 | Update config parsing | `src/config/project.ts`, `src/adapters/github.ts` |
| 7 | Update default config + example | `src/config/project.ts`, `.github/task-ai.md.example` |
| 8 | End-to-end smoke test | manual |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install packages**

```bash
npm install @mastra/rag @mastra/vector-libsql @ai-sdk/openai
```

`@mastra/rag` — chunking, embedding pipeline, `MDocument`
`@mastra/vector-libsql` — SQLite-backed local vector store (zero cloud setup)
`@ai-sdk/openai` — `text-embedding-3-small` via OpenAI API (1536 dims, cheap, fast)

**Step 2: Add env var**

Add to `.env.example`:
```
OPENAI_API_KEY=   # required for RAG embeddings (text-embedding-3-small)
```

**Step 3: Add startup warning in `src/index.ts`**

After the existing `ANTHROPIC_API_KEY` check, add:
```typescript
if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "[Agent] WARNING: OPENAI_API_KEY is not set. RAG knowledge search will be disabled.\n" +
    "Set OPENAI_API_KEY in .env to enable documentation/codebase search."
  );
}
```

**Step 4: Verify build compiles**

```bash
npm run build
```
Expected: no TypeScript errors.

---

## Task 2: Create Vector Store Singleton

**Files:**
- Create: `src/store/vector-store.ts`

**Purpose:** A single lazily-initialized LibSQL vector store shared across all ingestion and query calls. Two named collections: `docs` and `code`.

**Step 1: Write the file**

```typescript
// src/store/vector-store.ts
import { LibSQLVector } from "@mastra/vector-libsql";

// Stored in .mastra-vectors/ (gitignored)
// Two separate collections: "docs" for markdown/text, "code" for source files
let _store: LibSQLVector | null = null;

export function getVectorStore(): LibSQLVector {
  if (!_store) {
    _store = new LibSQLVector({
      connectionUrl: "file:.mastra-vectors/knowledge.db",
    });
  }
  return _store;
}

export const DOCS_INDEX = "docs";
export const CODE_INDEX = "code";
export const EMBEDDING_DIMENSIONS = 1536; // text-embedding-3-small
```

**Step 2: Add `.mastra-vectors/` to `.gitignore`**

```bash
echo ".mastra-vectors/" >> .gitignore
```

**Step 3: Verify TypeScript resolves the import**

```bash
npx ts-node -e "import { getVectorStore } from './src/store/vector-store'; console.log('ok');"
```
Expected: prints `ok`.

---

## Task 3: Create Ingestion Script

**Files:**
- Create: `scripts/ingest-knowledge.ts`

**Purpose:** CLI script that reads files from a directory, chunks them, generates embeddings, and upserts into the vector store. Run once to populate; re-run after docs/code change.

**Step 1: Write the script**

```typescript
// scripts/ingest-knowledge.ts
import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { openai } from "@ai-sdk/openai";
import { MDocument } from "@mastra/rag";
import { embed } from "ai";
import { getVectorStore, DOCS_INDEX, CODE_INDEX, EMBEDDING_DIMENSIONS } from "../src/store/vector-store";

const CHUNK_SIZE = 512;   // tokens — good balance for retrieval
const CHUNK_OVERLAP = 64;
const EMBED_MODEL = openai.embedding("text-embedding-3-small");

// File extensions treated as "code" vs "docs"
const CODE_EXTS = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".go"]);
const DOC_EXTS = new Set([".md", ".txt", ".mdx"]);

async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: EMBED_MODEL, value: text });
  return embedding;
}

async function ingestDirectory(dirPath: string, indexName: string): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    console.warn(`[Ingest] Directory not found: ${dirPath} — skipping`);
    return;
  }

  const store = getVectorStore();
  // Ensure the index exists with the correct dimensions
  const indexes = await store.listIndexes();
  if (!indexes.includes(indexName)) {
    await store.createIndex({ indexName, dimension: EMBEDDING_DIMENSIONS });
    console.log(`[Ingest] Created index "${indexName}"`);
  }

  const files = walkDir(dirPath);
  console.log(`[Ingest] Found ${files.length} files in ${dirPath}`);

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    const allowed = indexName === CODE_INDEX ? CODE_EXTS : DOC_EXTS;
    if (!allowed.has(ext)) continue;

    const content = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(process.cwd(), filePath);

    const doc = indexName === CODE_INDEX
      ? MDocument.fromText(content)
      : MDocument.fromMarkdown(content);

    const chunks = await doc.chunk({
      strategy: "recursive",
      size: CHUNK_SIZE,
      overlap: CHUNK_OVERLAP,
    });

    const vectors = await Promise.all(
      chunks.map((c) => embedText(c.text))
    );

    await store.upsert({
      indexName,
      vectors,
      metadata: chunks.map((c) => ({
        text: c.text,
        source: relativePath,
      })),
    });

    console.log(`[Ingest] ${relativePath} → ${chunks.length} chunks`);
  }
}

function walkDir(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      files.push(...walkDir(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

(async () => {
  const docsPath = process.argv[2];
  const codePath = process.argv[3];

  if (!docsPath && !codePath) {
    console.error("Usage: npx ts-node scripts/ingest-knowledge.ts [docsPath] [codePath]");
    console.error("Example: npx ts-node scripts/ingest-knowledge.ts ./docs ./src");
    process.exit(1);
  }

  if (docsPath) await ingestDirectory(docsPath, DOCS_INDEX);
  if (codePath) await ingestDirectory(codePath, CODE_INDEX);

  console.log("[Ingest] Done.");
  process.exit(0);
})();
```

**Step 2: Add npm script to `package.json`**

```json
"ingest": "ts-node scripts/ingest-knowledge.ts"
```

**Step 3: Run a smoke test against the project's own docs**

```bash
npm run ingest -- ./docs ./src
```
Expected: prints chunk counts per file, ends with `[Ingest] Done.`

---

## Task 4: Implement RAG Tools

**Files:**
- Modify: `src/mastra/tools/rag.ts`

**Purpose:** Replace the mock stubs with real vector store queries. Return top-5 ranked chunks with source filenames.

**Step 1: Rewrite `rag.ts`**

```typescript
// src/mastra/tools/rag.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { getVectorStore, DOCS_INDEX, CODE_INDEX } from "../../store/vector-store";

const EMBED_MODEL = openai.embedding("text-embedding-3-small");
const TOP_K = 5;

interface RagResult {
  text: string;
  source: string;
  score: number;
}

async function queryIndex(indexName: string, query: string): Promise<RagResult[]> {
  const { embedding } = await embed({ model: EMBED_MODEL, value: query });
  const store = getVectorStore();

  const results = await store.query({
    indexName,
    queryVector: embedding,
    topK: TOP_K,
    includeMetadata: true,
  });

  return results.map((r) => ({
    text: (r.metadata?.text as string) ?? "",
    source: (r.metadata?.source as string) ?? "unknown",
    score: r.score ?? 0,
  }));
}

export const searchDocsTool = createTool({
  id: "search_docs",
  description:
    "Search project documentation for relevant context. " +
    "Use this BEFORE writing a Development Plan to find existing docs, ADRs, or specs related to the task.",
  inputSchema: z.object({
    query: z.string().describe("Natural language search query about the topic"),
  }),
  execute: async ({ context }) => {
    if (!process.env.OPENAI_API_KEY) {
      return { results: [], message: "RAG not configured: OPENAI_API_KEY missing" };
    }
    try {
      const results = await queryIndex(DOCS_INDEX, context.query);
      return { results };
    } catch (err) {
      console.error("[RAG] search_docs error:", err);
      return { results: [], message: "Search failed — proceeding without docs context" };
    }
  },
});

export const searchCodeTool = createTool({
  id: "search_code",
  description:
    "Search the project codebase for relevant files and patterns. " +
    "Use this BEFORE writing a Development Plan to find existing implementations, patterns, or files to modify.",
  inputSchema: z.object({
    query: z.string().describe("Natural language search query about code patterns or files"),
  }),
  execute: async ({ context }) => {
    if (!process.env.OPENAI_API_KEY) {
      return { results: [], message: "RAG not configured: OPENAI_API_KEY missing" };
    }
    try {
      const results = await queryIndex(CODE_INDEX, context.query);
      return { results };
    } catch (err) {
      console.error("[RAG] search_code error:", err);
      return { results: [], message: "Search failed — proceeding without code context" };
    }
  },
});
```

**Step 2: Verify TypeScript compiles**

```bash
npm run build
```
Expected: no errors.

---

## Task 5: Wire RAG Tools into the Agent

**Files:**
- Modify: `src/mastra/agents/task-analyzer.ts`

**Purpose:** When `config.knowledge.enabled === true`, add the two RAG tools to the agent and update the system prompt to instruct it to search before planning.

**Step 1: Update `createTaskAnalyzerAgent`**

In `task-analyzer.ts`, find the `createTaskAnalyzerAgent` function and update:

```typescript
import { searchDocsTool, searchCodeTool } from "../tools/rag";

export function createTaskAnalyzerAgent(
  config: ProjectConfig,
  adapter: ProjectManagerAdapter
): Agent {
  const tools = createTools(adapter);

  // Add RAG tools when knowledge is enabled and OPENAI_API_KEY is available
  if (config.knowledge?.enabled && process.env.OPENAI_API_KEY) {
    tools["search_docs"] = searchDocsTool;
    tools["search_code"] = searchCodeTool;
  }

  const systemPrompt = buildSystemPrompt(config);
  return new Agent({
    name: `TaskAnalyzer-${config.name}`,
    instructions: systemPrompt,
    model: anthropic("claude-sonnet-4-5"),
    tools,
  });
}
```

**Step 2: Update `buildSystemPrompt` to add RAG instructions**

In `buildSystemPrompt`, append a conditional section after the `## ANALYSIS ALGORITHM` block:

```typescript
// Inside buildSystemPrompt(), after the ANALYSIS ALGORITHM section:
const ragSection = config.knowledge?.enabled
  ? `
---

## KNOWLEDGE SEARCH

You have access to \`search_docs\` and \`search_code\` tools that query this project's
documentation and codebase.

**When writing a Development Plan, you MUST:**
1. Call \`search_docs\` with the task title/keywords to find relevant specifications or ADRs
2. Call \`search_code\` with the feature area to find existing patterns and files to modify
3. Incorporate the search results into the **Technical Approach** and **Files to Change** sections
4. If results are empty or unhelpful, proceed using general conventions — do not mention the search

`
  : "";
```

Then add `ragSection` to the returned string.

**Step 3: Verify build + run**

```bash
npm run build && npm run dev
```
Expected: server starts, no errors.

---

## Task 6: Update ProjectConfig Parsing for `docsPath` / `codebasePath`

**Files:**
- Modify: `src/adapters/github.ts` — `fetchRepoConfig()`
- Modify: `src/config/project.ts` — `knowledge` field is already defined; just verify

**Purpose:** Parse `docsPath` and `codebasePath` from `.github/task-ai.md` frontmatter and pass them into the `ProjectConfig.knowledge` object.

**Step 1: Update `fetchRepoConfig` in `github.ts`**

In the `return { ... }` block that builds config from frontmatter, update the `knowledge` field:

```typescript
knowledge: {
  enabled: frontmatter.knowledge?.enabled ?? false,
  docsPath: frontmatter.knowledge?.docsPath ?? undefined,
  codebasePath: frontmatter.knowledge?.codebasePath ?? undefined,
},
```

**Step 2: No changes needed to `project.ts`** — the `knowledge` interface already has `docsPath?` and `codebasePath?`. Confirm these fields exist:

```typescript
knowledge?: {
  docsPath?: string;
  codebasePath?: string;
  enabled: boolean;
};
```

If they don't, add them now.

---

## Task 7: Add Example Repo Config

**Files:**
- Create: `.github/task-ai.md.example`

**Purpose:** Document how a repo enables RAG in its `task-ai.md`.

**Step 1: Write the example file**

```markdown
---
name: "My SaaS App"
techStack:
  - "Next.js 14"
  - "TypeScript"
  - "PostgreSQL"
conventions:
  - "Feature-based folder structure (src/features/<feature>/)"
  - "All API routes validated with Zod"
reviewCriteria:
  minDescriptionLength: 100
  requiredFields: ["title", "description"]
knowledge:
  enabled: true
  docsPath: "./docs"          # relative to repo root — markdown + txt files
  codebasePath: "./src"       # relative to repo root — .ts/.tsx files
---

# Project Notes

Additional free-form context the agent should know about this project.
```

**Step 2: Update `package.json` scripts** to document the ingest command:

```json
"ingest:docs": "ts-node scripts/ingest-knowledge.ts ./docs",
"ingest:code": "ts-node scripts/ingest-knowledge.ts '' ./src",
"ingest": "ts-node scripts/ingest-knowledge.ts ./docs ./src"
```

---

## Task 8: End-to-End Smoke Test

**Goal:** Verify the full pipeline — ingest → query → agent uses results.

**Step 1: Populate the vector store**

```bash
npm run ingest -- ./docs ./src
```
Expected: chunk counts logged per file, `[Ingest] Done.`

**Step 2: Check index was created**

```bash
npx ts-node -e "
  const { getVectorStore } = require('./src/store/vector-store');
  getVectorStore().listIndexes().then(console.log);
"
```
Expected: `[ 'docs', 'code' ]`

**Step 3: Start the server with RAG enabled**

In `.env`, ensure:
```
OPENAI_API_KEY=sk-...
```

Set `defaultProjectConfig.knowledge.enabled = true` temporarily for testing.

```bash
npm run dev
```

**Step 4: Trigger a GitHub issue analysis**

Apply the `ai-review` label to a real GitHub issue (or use the test script). Then check the agent trace via:

```bash
curl http://localhost:3000/api/status | jq '.[0].runs[-1].steps'
```

Expected: trace shows `search_docs` and `search_code` tool calls before `add_comment`.

**Step 5: Revert the temporary config change**

Set `knowledge.enabled = false` back in `defaultProjectConfig`.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **LibSQL (SQLite) vector store** | Zero cloud setup; file stored in `.mastra-vectors/`; can swap to Pinecone/PGVector later |
| **`text-embedding-3-small`** | 1536 dims, $0.02/1M tokens, fast; good balance for code+docs |
| **Two separate indexes** | Docs and code have different optimal chunk sizes and retrieval patterns |
| **Tool-level fallback** | RAG errors return empty results + message; agent continues without crashing |
| **Conditional tool injection** | RAG tools only added when `knowledge.enabled = true` AND `OPENAI_API_KEY` present — no behavior change for projects not opting in |
| **Ingestion as a script, not at runtime** | Vector indexes are built offline; avoids cold-start latency on first webhook hit |

---

## What's Left for Phase 3

- Smart re-ingestion: only re-embed files that changed (hash-based diffing)
- Per-chunk citation in the Development Plan (agent includes `source` filenames)
- Streaming ingestion progress via Server-Sent Events in the dashboard
- Support for PDF and HTML documentation sources
