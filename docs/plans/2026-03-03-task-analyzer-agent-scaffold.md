# Task Analyzer Agent — Scaffold Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scaffold a TypeScript AI agent that analyzes project management tasks (Trello/Asana) via webhooks, using Mastra + Claude, and produces either a Development Plan or clarifying questions.

**Architecture:** Express server receives webhook events → Mastra workflow checks task quality → TaskAnalyzer agent (Claude via @ai-sdk/anthropic) analyzes and responds. Two mock adapters (Trello, Asana) simulate real PM tools. Phase 2 RAG stubs are wired but unimplemented.

**Tech Stack:** Node.js, TypeScript, Mastra (`@mastra/core`), Anthropic Claude (`@ai-sdk/anthropic`), Express, Zod, dotenv

---

## Task 1: Project Initialization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.env`

**Step 1: Create package.json**

```json
{
  "name": "pmt-tc-agent",
  "version": "1.0.0",
  "description": "AI agent that analyzes project management tasks",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test:trello": "curl -X POST http://localhost:3000/webhook/trello -H 'Content-Type: application/json' -d '{\"taskId\": \"TRELLO-001\"}'",
    "test:asana": "curl -X POST http://localhost:3000/webhook/asana -H 'Content-Type: application/json' -d '{\"taskId\": \"ASANA-001\"}'"
  },
  "dependencies": {
    "@ai-sdk/anthropic": "^1.1.17",
    "@mastra/core": "^0.7.0",
    "ai": "^4.1.46",
    "dotenv": "^16.0.0",
    "express": "^4.18.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create .env.example**

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

**Step 4: Create .env** (copy of .env.example, no real values)

Same content as .env.example — leave `ANTHROPIC_API_KEY=sk-ant-...` as placeholder.

**Step 5: Install dependencies**

```bash
cd "/Users/vtsaryk/Library/CloudStorage/Dropbox/Artvens Digital Agency/sites/pmt-tc-agent"
npm install
```

Expected: `node_modules/` created, no errors.

**Step 6: Commit**

```bash
git add package.json tsconfig.json .env.example
git commit -m "chore: initialize project with dependencies"
```

---

## Task 2: Adapter Interface and Types

**Files:**
- Create: `src/adapters/interface.ts`

**Step 1: Create directory**

```bash
mkdir -p src/adapters
```

**Step 2: Write src/adapters/interface.ts**

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

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
git add src/adapters/interface.ts
git commit -m "feat: add adapter interface and shared types"
```

---

## Task 3: Project Config

**Files:**
- Create: `src/config/project.ts`

**Step 1: Create directory**

```bash
mkdir -p src/config
```

**Step 2: Write src/config/project.ts**

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

export const defaultProjectConfig: ProjectConfig = {
  name: "MyApp",
  techStack: [
    "Next.js 14",
    "TypeScript",
    "PostgreSQL",
    "Prisma ORM",
    "Tailwind CSS",
    "Jest",
  ],
  conventions: [
    "Feature-based folder structure (src/features/<feature>/)",
    "Server components by default, client components only when needed",
    "Database access only via Prisma (no raw SQL)",
    "All API routes validated with Zod",
    "Unit tests required for business logic",
  ],
  reviewCriteria: {
    minDescriptionLength: 50,
    requiredFields: ["title", "description"],
  },
  knowledge: {
    enabled: false,
    // Phase 2: set docsPath and codebasePath when RAG is connected
  },
};
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
git add src/config/project.ts
git commit -m "feat: add ProjectConfig interface and default config"
```

---

## Task 4: Trello Mock Adapter

**Files:**
- Create: `src/adapters/trello.ts`

**Step 1: Write src/adapters/trello.ts**

```typescript
import { ProjectManagerAdapter, Task, TaskStatus } from "./interface";

const mockTasks: Record<string, Task> = {
  "TRELLO-001": {
    id: "TRELLO-001",
    title: "Implement user authentication with OAuth2",
    description:
      "Add OAuth2 authentication to the application. Users should be able to sign in with Google and GitHub. " +
      "Implement the following: (1) Install next-auth v5 and configure OAuth providers. " +
      "(2) Create /api/auth/[...nextauth]/route.ts handler. " +
      "(3) Add sign-in/sign-out buttons to the header. " +
      "(4) Protect dashboard routes with middleware. " +
      "(5) Store user sessions in PostgreSQL via Prisma adapter. " +
      "Acceptance criteria: unauthenticated users redirected to /login, " +
      "authenticated users see their avatar in the header.",
    assignee: "alice@example.com",
    labels: ["feature", "auth", "backend"],
    url: "https://trello.com/c/TRELLO-001",
    source: "trello",
    metadata: {
      boardId: "board-123",
      listName: "In Progress",
      dueDate: "2026-03-15",
    },
  },
  "TRELLO-002": {
    id: "TRELLO-002",
    title: "Fix the dashboard",
    description: "Something is broken on the dashboard page. Please fix it.",
    assignee: null,
    labels: ["bug"],
    url: "https://trello.com/c/TRELLO-002",
    source: "trello",
    metadata: {
      boardId: "board-123",
      listName: "Backlog",
    },
  },
  "TRELLO-003": {
    id: "TRELLO-003",
    title: "Add CSV export to reports",
    description:
      "Users need to export their monthly reports as CSV files. " +
      "Add an 'Export CSV' button to the /reports page. " +
      "On click, generate a CSV with columns: Date, Category, Amount, Description. " +
      "Use the papaparse library for CSV generation. " +
      "The file should be named 'report-YYYY-MM.csv'. " +
      "Acceptance criteria: CSV downloads correctly in Chrome and Firefox, " +
      "all report rows are included, no empty rows.",
    assignee: "bob@example.com",
    labels: ["feature", "reports"],
    url: "https://trello.com/c/TRELLO-003",
    source: "trello",
    metadata: {
      boardId: "board-456",
      listName: "To Do",
    },
  },
};

export class TrelloAdapter implements ProjectManagerAdapter {
  source = "trello" as const;

  async getTask(taskId: string): Promise<Task> {
    // TODO: replace with real API call
    console.log(`[TrelloAdapter] getTask("${taskId}")`);
    const task = mockTasks[taskId];
    if (!task) {
      throw new Error(`[TrelloAdapter] Task not found: ${taskId}`);
    }
    return task;
  }

  async addComment(taskId: string, comment: string): Promise<void> {
    // TODO: replace with real API call
    console.log(`[TrelloAdapter] addComment("${taskId}", "${comment.substring(0, 80)}...")`);
  }

  async setStatus(taskId: string, status: TaskStatus): Promise<void> {
    // TODO: replace with real API call
    console.log(`[TrelloAdapter] setStatus("${taskId}", "${status}")`);
  }
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/adapters/trello.ts
git commit -m "feat: add TrelloAdapter with mock tasks"
```

---

## Task 5: Asana Mock Adapter

**Files:**
- Create: `src/adapters/asana.ts`

**Step 1: Write src/adapters/asana.ts**

```typescript
import { ProjectManagerAdapter, Task, TaskStatus } from "./interface";

const mockTasks: Record<string, Task> = {
  "ASANA-001": {
    id: "ASANA-001",
    title: "Migrate database to PostgreSQL 16",
    description:
      "Upgrade the database from PostgreSQL 14 to PostgreSQL 16. Steps: " +
      "(1) Back up all production data. " +
      "(2) Update docker-compose.yml to use postgres:16-alpine. " +
      "(3) Run pg_upgrade or pg_dumpall + restore. " +
      "(4) Update connection string in .env.production. " +
      "(5) Run full regression test suite. " +
      "(6) Monitor for 48 hours post-migration. " +
      "Rollback plan: restore from backup if error rate > 1%. " +
      "Acceptance criteria: all tests pass on PG16, p99 query time unchanged.",
    assignee: "charlie@example.com",
    labels: ["infrastructure", "database"],
    url: "https://app.asana.com/0/1/ASANA-001",
    source: "asana",
    metadata: {
      projectId: "asana-project-789",
      sectionName: "Sprint 12",
      priority: "high",
    },
  },
  "ASANA-002": {
    id: "ASANA-002",
    title: "Improve performance",
    description: "The app feels slow. Make it faster.",
    assignee: null,
    labels: ["performance"],
    url: "https://app.asana.com/0/1/ASANA-002",
    source: "asana",
    metadata: {
      projectId: "asana-project-789",
      sectionName: "Backlog",
      priority: "medium",
    },
  },
};

export class AsanaAdapter implements ProjectManagerAdapter {
  source = "asana" as const;

  async getTask(taskId: string): Promise<Task> {
    // TODO: replace with real API call
    console.log(`[AsanaAdapter] getTask("${taskId}")`);
    const task = mockTasks[taskId];
    if (!task) {
      throw new Error(`[AsanaAdapter] Task not found: ${taskId}`);
    }
    return task;
  }

  async addComment(taskId: string, comment: string): Promise<void> {
    // TODO: replace with real API call
    console.log(`[AsanaAdapter] addComment("${taskId}", "${comment.substring(0, 80)}...")`);
  }

  async setStatus(taskId: string, status: TaskStatus): Promise<void> {
    // TODO: replace with real API call
    console.log(`[AsanaAdapter] setStatus("${taskId}", "${status}")`);
  }
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/adapters/asana.ts
git commit -m "feat: add AsanaAdapter with mock tasks"
```

---

## Task 6: Mastra Tools

**Files:**
- Create: `src/mastra/tools/index.ts`
- Create: `src/mastra/tools/rag.ts`

**Step 1: Create directories**

```bash
mkdir -p src/mastra/tools
```

**Step 2: Write src/mastra/tools/rag.ts**

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const searchDocsTool = createTool({
  id: "search_docs",
  description: "Search project documentation for relevant context (Phase 2)",
  inputSchema: z.object({
    query: z.string().describe("Search query for documentation"),
  }),
  execute: async ({ context }) => {
    // TODO: replace with mastra.vector.query(...) against embedded docs
    console.log(`[RAG] search_docs called with: "${context.query}" (mock)`);
    return {
      results: [],
      message: "RAG not connected (Phase 2)",
    };
  },
});

export const searchCodeTool = createTool({
  id: "search_code",
  description: "Search codebase for relevant files and patterns (Phase 2)",
  inputSchema: z.object({
    query: z.string().describe("Search query for codebase"),
  }),
  execute: async ({ context }) => {
    // TODO: replace with mastra.vector.query(...) against embedded codebase
    console.log(`[RAG] search_code called with: "${context.query}" (mock)`);
    return {
      results: [],
      message: "RAG not connected (Phase 2)",
    };
  },
});
```

**Step 3: Write src/mastra/tools/index.ts**

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ProjectManagerAdapter } from "../../adapters/interface";

export function createTools(adapter: ProjectManagerAdapter): Record<string, ReturnType<typeof createTool>> {
  const getTaskTool = createTool({
    id: "get_task",
    description: "Retrieve a task by ID from the project management system",
    inputSchema: z.object({
      taskId: z.string().describe("The task identifier"),
    }),
    execute: async ({ context }) => {
      return adapter.getTask(context.taskId);
    },
  });

  const addCommentTool = createTool({
    id: "add_comment",
    description: "Add a comment to a task",
    inputSchema: z.object({
      taskId: z.string().describe("The task identifier"),
      comment: z.string().describe("The comment text to add"),
    }),
    execute: async ({ context }) => {
      await adapter.addComment(context.taskId, context.comment);
      return { success: true };
    },
  });

  const setStatusTool = createTool({
    id: "set_status",
    description: "Set the status of a task",
    inputSchema: z.object({
      taskId: z.string().describe("The task identifier"),
      status: z
        .enum(["needs_clarification", "ready_for_dev"])
        .describe("The new status"),
    }),
    execute: async ({ context }) => {
      await adapter.setStatus(context.taskId, context.status);
      return { success: true };
    },
  });

  return {
    get_task: getTaskTool,
    add_comment: addCommentTool,
    set_status: setStatusTool,
  };
}
```

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 5: Commit**

```bash
git add src/mastra/tools/
git commit -m "feat: add Mastra tools (get_task, add_comment, set_status) and RAG stubs"
```

---

## Task 7: Task Analyzer Agent

**Files:**
- Create: `src/mastra/agents/task-analyzer.ts`

**Step 1: Create directory**

```bash
mkdir -p src/mastra/agents
```

**Step 2: Write src/mastra/agents/task-analyzer.ts**

```typescript
import { Agent } from "@mastra/core/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { ProjectManagerAdapter } from "../../adapters/interface";
import { ProjectConfig } from "../../config/project";
import { createTools } from "../tools/index";

// TODO: Phase 2 — when knowledge.enabled, add searchDocs and searchCode to tools
//                  and instruct the agent to consult them before writing a plan

function buildSystemPrompt(config: ProjectConfig): string {
  return `
You are TaskAnalyzer, an AI agent that analyzes software development tasks from project management tools.
You help development teams by either writing actionable Development Plans or asking clarifying questions.

All responses must be written in English.

---

## PROJECT CONTEXT

Project: ${config.name}

Tech Stack:
${config.techStack.map((t) => `- ${t}`).join("\n")}

Conventions:
${config.conventions.map((c) => `- ${c}`).join("\n")}

---

## EVALUATION RULES

A task is considered CLEAR if ALL of the following are true:
- Description length is at least ${config.reviewCriteria.minDescriptionLength} characters
- The following fields are present and non-empty: ${config.reviewCriteria.requiredFields.join(", ")}
- The goal is unambiguous (what to build is clear)
- The scope is bounded (you can estimate the work)
- Success criteria can be defined

A task is UNCLEAR if ANY of the following are true:
- Description is vague (e.g., "fix the bug", "improve performance")
- Missing required context (which page, which API, which user role)
- Success criteria are absent or unmeasurable
- The task mixes multiple unrelated concerns

---

## ANALYSIS ALGORITHM

1. Use the \`get_task\` tool to retrieve the task details.
2. Evaluate the task against the EVALUATION RULES above.
3. If CLEAR → write a Development Plan and use \`set_status\` with "ready_for_dev", then post it as a comment with \`add_comment\`.
4. If UNCLEAR → write Clarifying Questions and use \`set_status\` with "needs_clarification", then post them as a comment with \`add_comment\`.

---

## DEVELOPMENT PLAN TEMPLATE

When a task is clear, produce a plan using EXACTLY this format:

\`\`\`
## Development Plan: [Task Title]

### Goal
[One sentence: what this task builds or fixes]

### Technical Approach
[2-4 sentences: how you will implement it, which patterns/libraries to use,
why this approach fits the project conventions]

### Files to Change
- **Create:** \`path/to/new/file.ts\` — [reason]
- **Modify:** \`path/to/existing/file.ts\` — [what changes]
- **Test:** \`path/to/test/file.test.ts\` — [what to test]

### Definition of Done
- [ ] [Acceptance criterion 1]
- [ ] [Acceptance criterion 2]
- [ ] [Tests pass]
- [ ] [No TypeScript errors]

### Risks
- [Risk 1 and mitigation]
- [Risk 2 and mitigation]

### Time Estimate
[X–Y hours] — [brief justification]
\`\`\`

---

## CLARIFYING QUESTIONS TEMPLATE

When a task is unclear, produce questions using EXACTLY this format:

\`\`\`
## Clarifying Questions for: [Task Title]

Before this task can be developed, please answer the following questions:

1. **[Topic]:** [Specific question?]
2. **[Topic]:** [Specific question?]
3. **[Topic]:** [Specific question?]

Once these are answered, I can write a full Development Plan.
\`\`\`
`.trim();
}

export function createTaskAnalyzerAgent(
  config: ProjectConfig,
  adapter: ProjectManagerAdapter
): Agent {
  const tools = createTools(adapter);
  const systemPrompt = buildSystemPrompt(config);

  return new Agent({
    name: `TaskAnalyzer-${config.name}`,
    instructions: systemPrompt,
    model: anthropic("claude-sonnet-4-5"),
    tools,
  });
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
git add src/mastra/agents/task-analyzer.ts
git commit -m "feat: add TaskAnalyzer agent factory with dynamic system prompt"
```

---

## Task 8: Review Task Workflow

**Files:**
- Create: `src/mastra/workflows/review-task.ts`

**Step 1: Create directory**

```bash
mkdir -p src/mastra/workflows
```

**Step 2: Write src/mastra/workflows/review-task.ts**

```typescript
import { Workflow, Step } from "@mastra/core/workflows";
import { z } from "zod";
import { ProjectManagerAdapter } from "../../adapters/interface";
import { ProjectConfig } from "../../config/project";
import { createTaskAnalyzerAgent } from "../agents/task-analyzer";

// TODO: add a delay before checkDescription to give the author time to write a description
// In production: use Mastra's built-in step delays or an external queue (e.g. BullMQ)

export function createReviewTaskWorkflow(
  config: ProjectConfig,
  adapter: ProjectManagerAdapter
): Workflow {
  const agent = createTaskAnalyzerAgent(config, adapter);

  const checkDescription = new Step({
    id: "checkDescription",
    description: "Fetch task and check if description meets review criteria",
    inputSchema: z.object({
      taskId: z.string(),
    }),
    execute: async ({ context }) => {
      const taskId = context.taskId as string;
      const task = await adapter.getTask(taskId);

      const { minDescriptionLength, requiredFields } = config.reviewCriteria;

      const descriptionLongEnough =
        task.description.length >= minDescriptionLength;

      const hasRequiredFields = requiredFields.every((field) => {
        const value = task[field as keyof typeof task];
        return value !== null && value !== undefined && value !== "";
      });

      const passed = descriptionLongEnough && hasRequiredFields;

      return {
        taskId,
        task,
        passed,
        reason: !passed
          ? !descriptionLongEnough
            ? `Description is too short (${task.description.length} chars, minimum ${minDescriptionLength})`
            : `Missing required fields: ${requiredFields.join(", ")}`
          : "Description meets criteria",
      };
    },
  });

  const analyzeOrRemind = new Step({
    id: "analyzeOrRemind",
    description: "Run agent analysis or post a reminder to improve the task",
    execute: async ({ context }) => {
      const { taskId, passed, task, reason } = context.machineContext?.stepResults?.checkDescription?.payload as {
        taskId: string;
        passed: boolean;
        task: { title: string };
        reason: string;
      };

      if (passed) {
        console.log(`[Workflow] Task "${taskId}" passed criteria — running agent analysis`);
        const result = await agent.generate(
          `Analyze this task and produce either a Development Plan or Clarifying Questions: taskId=${taskId}`
        );
        return {
          action: "analyzed",
          taskId,
          result: result.text,
        };
      } else {
        console.log(`[Workflow] Task "${taskId}" failed criteria — posting reminder`);
        const reminder =
          `👋 Hi! Before this task can be analyzed, please improve the description.\n\n` +
          `**Reason:** ${reason}\n\n` +
          `Please add:\n` +
          `- A clear description of what needs to be done (at least ${config.reviewCriteria.minDescriptionLength} characters)\n` +
          `- Acceptance criteria\n` +
          `- Any relevant technical context\n\n` +
          `Once updated, the agent will automatically re-analyze the task.`;

        await adapter.addComment(taskId, reminder);
        await adapter.setStatus(taskId, "needs_clarification");

        return {
          action: "reminded",
          taskId,
          reason,
        };
      }
    },
  });

  const workflow = new Workflow({
    name: `review-task-${config.name}`,
    triggerSchema: z.object({
      taskId: z.string(),
    }),
  });

  workflow
    .step(checkDescription)
    .then(analyzeOrRemind)
    .commit();

  return workflow;
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors (or only minor type warnings from Mastra internals — acceptable).

**Step 4: Commit**

```bash
git add src/mastra/workflows/review-task.ts
git commit -m "feat: add review-task workflow with checkDescription and analyzeOrRemind steps"
```

---

## Task 9: Mastra Instance

**Files:**
- Create: `src/mastra/index.ts`

**Step 1: Write src/mastra/index.ts**

```typescript
import { Mastra } from "@mastra/core";
import { TrelloAdapter } from "../adapters/trello";
import { AsanaAdapter } from "../adapters/asana";
import { defaultProjectConfig } from "../config/project";
import { createTaskAnalyzerAgent } from "./agents/task-analyzer";

const trelloAdapter = new TrelloAdapter();
const asanaAdapter = new AsanaAdapter();

const trelloAgent = createTaskAnalyzerAgent(defaultProjectConfig, trelloAdapter);
const asanaAgent = createTaskAnalyzerAgent(defaultProjectConfig, asanaAdapter);

export const mastra = new Mastra({
  agents: {
    [trelloAgent.name]: trelloAgent,
    [asanaAgent.name]: asanaAgent,
  },
});

export { trelloAdapter, asanaAdapter };
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/mastra/index.ts
git commit -m "feat: initialize Mastra instance with Trello and Asana agents"
```

---

## Task 10: Express Server

**Files:**
- Create: `src/server.ts`

**Step 1: Write src/server.ts**

```typescript
import express, { Request, Response, NextFunction } from "express";
import { ProjectManagerAdapter } from "./adapters/interface";
import { ProjectConfig, defaultProjectConfig } from "./config/project";
import { TrelloAdapter } from "./adapters/trello";
import { AsanaAdapter } from "./adapters/asana";
import { createReviewTaskWorkflow } from "./mastra/workflows/review-task";

// Initialize adapters once at startup — not per request
const trelloAdapter = new TrelloAdapter();
const asanaAdapter = new AsanaAdapter();

async function handleTaskEvent(
  taskId: string,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig
): Promise<void> {
  const workflow = createReviewTaskWorkflow(config, adapter);

  const { start } = workflow.createRun();
  await start({ triggerData: { taskId } });
}

export function createServer(): express.Application {
  const app = express();

  app.use(express.json());

  // Request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", adapters: ["trello", "asana"] });
  });

  // Trello webhook
  app.post("/webhook/trello", async (req: Request, res: Response) => {
    // TODO: verify webhook signature
    try {
      const { taskId } = req.body as { taskId?: string };
      if (!taskId) {
        res.status(400).json({ error: "Missing taskId in request body" });
        return;
      }
      // Respond immediately — processing happens asynchronously
      res.status(202).json({ status: "accepted", taskId });
      await handleTaskEvent(taskId, trelloAdapter, defaultProjectConfig);
    } catch (error) {
      console.error("[Server] Error processing Trello webhook:", error);
    }
  });

  // Asana webhook
  app.post("/webhook/asana", async (req: Request, res: Response) => {
    // TODO: verify webhook signature
    try {
      const { taskId } = req.body as { taskId?: string };
      if (!taskId) {
        res.status(400).json({ error: "Missing taskId in request body" });
        return;
      }
      // Respond immediately — processing happens asynchronously
      res.status(202).json({ status: "accepted", taskId });
      await handleTaskEvent(taskId, asanaAdapter, defaultProjectConfig);
    } catch (error) {
      console.error("[Server] Error processing Asana webhook:", error);
    }
  });

  return app;
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: add Express server with webhook handlers and request logging"
```

---

## Task 11: Entry Point

**Files:**
- Create: `src/index.ts`

**Step 1: Write src/index.ts**

```typescript
import dotenv from "dotenv";
dotenv.config();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "[Agent] ERROR: ANTHROPIC_API_KEY is not set.\n" +
    "Please copy .env.example to .env and add your API key."
  );
  process.exit(1);
}

import { createServer } from "./server";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const app = createServer();

app.listen(PORT, () => {
  console.log(`[Agent] Server running on http://localhost:${PORT}`);
  console.log(`[Agent] Webhooks:`);
  console.log(`  POST http://localhost:${PORT}/webhook/trello`);
  console.log(`  POST http://localhost:${PORT}/webhook/asana`);
});
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point with env validation and server startup"
```

---

## Task 12: Final Verification

**Step 1: Full TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: Zero errors.

**Step 2: Start the dev server**

```bash
npm run dev
```

Expected output:
```
[Agent] Server running on http://localhost:3000
[Agent] Webhooks:
  POST http://localhost:3000/webhook/trello
  POST http://localhost:3000/webhook/asana
```

**Step 3: Test health endpoint (new terminal)**

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"ok","adapters":["trello","asana"]}`

**Step 4: Test with a clear Trello task**

```bash
npm run test:trello
```

Expected in server logs:
- `[TrelloAdapter] getTask("TRELLO-001")`
- Agent generates a Development Plan
- `[TrelloAdapter] setStatus("TRELLO-001", "ready_for_dev")`
- `[TrelloAdapter] addComment("TRELLO-001", ...)`

**Step 5: Test with a vague task**

```bash
curl -X POST http://localhost:3000/webhook/trello \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "TRELLO-002"}'
```

Expected in server logs:
- `[TrelloAdapter] getTask("TRELLO-002")`
- Agent generates Clarifying Questions
- `[TrelloAdapter] setStatus("TRELLO-002", "needs_clarification")`
- `[TrelloAdapter] addComment("TRELLO-002", ...)`

**Step 6: Final commit**

```bash
git add docs/
git commit -m "docs: add implementation plan"
```

---

## Summary

After all tasks are complete, print:

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
