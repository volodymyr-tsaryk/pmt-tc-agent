we are working in "/Users/vtsaryk/Library/CloudStorage/Dropbox/Artvens Digital Agency/sites/pmt-tc-agent" and that is valid directory.

# Task Analyzer Agent — Project Scaffold

## Overview

Scaffold a TypeScript project for an AI agent that analyzes project management tasks (Trello, Asana, and others).

The agent receives tasks via webhook events, analyzes them, and either:
- Writes a **Development Plan** if the task is clear enough
- Asks **clarifying questions** if the task is too vague

---

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **AI Framework:** Mastra (`@mastra/core`)
- **LLM:** Anthropic Claude via (`@ai-sdk/anthropic`)
- **HTTP Server:** Express
- **Validation:** Zod
- **Config:** dotenv

---

## Project Structure

Scaffold exactly this structure — no more, no less:

```
src/
├── mastra/
│   ├── index.ts                  ← Mastra instance initialization
│   ├── agents/
│   │   └── task-analyzer.ts      ← agent factory + dynamic system prompt
│   ├── tools/
│   │   ├── index.ts              ← createTools(adapter) factory
│   │   └── rag.ts                ← RAG tools (stubs for Phase 2)
│   └── workflows/
│       └── review-task.ts        ← workflow: webhook → check → analyze
├── adapters/
│   ├── interface.ts              ← ProjectManagerAdapter interface + shared types
│   ├── trello.ts                 ← TrelloAdapter (mock implementation)
│   └── asana.ts                  ← AsanaAdapter (mock implementation)
├── config/
│   └── project.ts                ← ProjectConfig interface + default example
├── server.ts                     ← Express server + webhook handlers
└── index.ts                      ← entry point
```

---

## File-by-File Requirements

### `src/adapters/interface.ts`

Define these types and the adapter interface:

```typescript
export type TaskStatus = "needs_clarification" | "ready_for_dev";
export type AdapterSource = "trello" | "asana";

export interface Task {
  id: string;
  title: string;
  description: string;
  assignee: string | null;
  labels: string[];
  url: string;
  source: AdapterSource;
  metadata: Record<string, unknown>; // service-specific raw data
}

export interface ProjectManagerAdapter {
  source: AdapterSource;
  getTask(taskId: string): Promise<Task>;
  addComment(taskId: string, comment: string): Promise<void>;
  setStatus(taskId: string, status: TaskStatus): Promise<void>;
}
```

---

### `src/adapters/trello.ts` and `src/adapters/asana.ts`

**Use MOCK implementations only** — do NOT call real APIs.

Each adapter must have:
- A local `const mockTasks: Record<string, Task>` with 2–3 sample tasks:
  - One task that is **detailed and clear** → agent should write a dev plan
  - One task that is **vague and incomplete** → agent should ask questions
- Full implementation of all 3 interface methods
- `console.log` in each method so execution is visible in the terminal
- A comment `// TODO: replace with real API call` above each method body

Each adapter uses different task ID prefixes:
- Trello: `TRELLO-001`, `TRELLO-002`
- Asana: `ASANA-001`, `ASANA-002`

---

### `src/config/project.ts`

Per-project configuration that controls agent behavior.
The agent adapts its analysis based on this config.

```typescript
export interface ProjectConfig {
  name: string;
  techStack: string[];
  conventions: string[];
  reviewCriteria: {
    minDescriptionLength: number;
    requiredFields: string[];
  };
  // Phase 2: RAG — define the shape now, implement later
  knowledge?: {
    docsPath?: string;
    codebasePath?: string;
    enabled: boolean;
  };
}
```

Export a `defaultProjectConfig` example with realistic values
(e.g. Next.js 14, PostgreSQL, TypeScript, feature-based folder structure).

---

### `src/mastra/agents/task-analyzer.ts`

Export a factory function — not a singleton.
The agent is configured per-project and per-adapter:

```typescript
export function createTaskAnalyzerAgent(
  config: ProjectConfig,
  adapter: ProjectManagerAdapter
): Agent
```

Inside the factory:
1. Call `createTools(adapter)` to get the tool set
2. Call `buildSystemPrompt(config)` to build the prompt dynamically
3. Return a `new Agent({ ... })` with name `TaskAnalyzer-${config.name}`

The `buildSystemPrompt(config)` function must:
- Include the analysis algorithm (clear / unclear decision logic)
- Include a **Development Plan** template with sections:
  `Goal`, `Technical Approach`, `Files to Change`, `Definition of Done`, `Risks`, `Time Estimate`
- Include a **Clarifying Questions** template
- Inject `config.techStack` and `config.conventions` as context
- Inject `config.reviewCriteria` as evaluation rules
- Leave a clearly marked placeholder for Phase 2:
  ```
  // TODO: Phase 2 — when knowledge.enabled, add searchDocs and searchCode to tools
  //                  and instruct the agent to consult them before writing a plan
  ```
- All agent responses must be in **English**

---

### `src/mastra/tools/index.ts`

```typescript
export function createTools(adapter: ProjectManagerAdapter): Record<string, Tool>
```

Returns 3 tools: `get_task`, `add_comment`, `set_status`.
Each tool delegates to the adapter — tools contain no business logic.
Use Zod for input schema validation.

---

### `src/mastra/tools/rag.ts`

Phase 2 stubs — correct structure, no real implementation.

```typescript
export const searchDocsTool = createTool({ ... })
export const searchCodeTool = createTool({ ... })
```

Each stub must:
- Have a proper `inputSchema` with a `query: z.string()` field
- Log `[RAG] toolName called with: "..." (mock)` to the console
- Return `{ results: [], message: "RAG not connected (Phase 2)" }`
- Have a `// TODO: replace with mastra.vector.query(...)` comment

---

### `src/mastra/workflows/review-task.ts`

A two-step workflow:

1. **`checkDescription`** — reads the task and checks against `config.reviewCriteria`
2. **`analyzeOrRemind`** — branches:
   - If description passes criteria → runs the agent
   - If not → adds a reminder comment via adapter

Add this comment before the workflow definition:
```typescript
// TODO: add a delay before checkDescription to give the author time to write a description
// In production: use Mastra's built-in step delays or an external queue (e.g. BullMQ)
```

Export a factory:
```typescript
export function createReviewTaskWorkflow(
  config: ProjectConfig,
  adapter: ProjectManagerAdapter
): Workflow
```

---

### `src/server.ts`

Express server with:

```
POST /webhook/trello   ← handles Trello webhook events
POST /webhook/asana    ← handles Asana webhook events
GET  /health           ← returns { status: "ok", adapters: ["trello", "asana"] }
```

Both webhook handlers delegate to a shared function:
```typescript
async function handleTaskEvent(
  taskId: string,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig
): Promise<void>
```

Requirements:
- Add request logging middleware that prints `[timestamp] METHOD /path` for every request
- Load `defaultProjectConfig` from config — in production this would be loaded per-project
- Initialize both adapters at startup, not per-request
- Wrap all webhook logic in try/catch and return appropriate HTTP status codes

---

### `src/mastra/index.ts`

Initialize and export the Mastra instance.
Register agents using both adapters and the default config.

---

### `src/index.ts`

Entry point that:
1. Loads `.env`
2. Validates that `ANTHROPIC_API_KEY` is set — exits with a clear error if not
3. Starts the Express server on `PORT` from env (default: `3000`)
4. Logs the available webhook URLs on startup:
   ```
   [Agent] Server running on http://localhost:3000
   [Agent] Webhooks:
     POST http://localhost:3000/webhook/trello
     POST http://localhost:3000/webhook/asana
   ```

---

## Environment Variables

Create a `.env.example` file:

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional
PORT=3000

# Phase 2: Trello (uncomment when connecting real API)
# TRELLO_API_KEY=
# TRELLO_TOKEN=

# Phase 2: Asana (uncomment when connecting real API)
# ASANA_TOKEN=
```

Also create `.env` as a copy of `.env.example` (without real values).

---

## package.json Scripts

```json
{
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test:trello": "curl -X POST http://localhost:3000/webhook/trello -H 'Content-Type: application/json' -d '{\"taskId\": \"TRELLO-001\"}'",
    "test:asana": "curl -X POST http://localhost:3000/webhook/asana -H 'Content-Type: application/json' -d '{\"taskId\": \"ASANA-001\"}'"
  }
}
```

---

## What NOT to implement

Leave these for the developer to implement as learning exercises:

- ❌ Real Trello or Asana API calls (keep mocks)
- ❌ RAG / vector store logic (stubs only)
- ❌ Webhook signature verification (add a `// TODO: verify webhook signature` comment)
- ❌ Persistent storage of analysis results
- ❌ Retry logic for failed agent runs
- ❌ Multi-project config loading (single defaultProjectConfig is enough)

Each of these should have a `// TODO:` comment explaining what needs to be done.

---

## After Scaffolding

Print a summary:

```
✅ Project scaffolded successfully

Next steps:
  1. npm install
  2. cp .env.example .env  (add your ANTHROPIC_API_KEY)
  3. npm run dev
  4. In another terminal: npm run test:trello

Learning exercises (implement these yourself):
  - [ ] Connect real Trello API in src/adapters/trello.ts
  - [ ] Connect real Asana API in src/adapters/asana.ts
  - [ ] Add webhook signature verification in src/server.ts
  - [ ] Implement RAG tools in src/mastra/tools/rag.ts (Phase 2)
  - [ ] Add per-project config loading (e.g. from a JSON file or DB)
```
