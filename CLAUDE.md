# Task Analyzer Agent

AI agent that analyzes project management tasks (Trello, Asana) via webhooks and either writes a **Development Plan** or asks **clarifying questions**.

Working directory: `/Users/vtsaryk/Library/CloudStorage/Dropbox/Artvens Digital Agency/sites/pmt-tc-agent`

## Git Commits

Do NOT commit, suggest committing, or ask about committing changes unless the user explicitly requests it.

---

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **AI Framework:** Mastra (`@mastra/core`)
- **LLM:** Anthropic Claude (`@ai-sdk/anthropic`)
- **HTTP Server:** Express
- **Validation:** Zod
- **Config:** dotenv

---

## Project Structure

```
src/
├── mastra/
│   ├── index.ts                  ← Mastra instance (registers agents for both adapters)
│   ├── agents/
│   │   └── task-analyzer.ts      ← createTaskAnalyzerAgent(config, adapter) factory
│   ├── tools/
│   │   ├── index.ts              ← createTools(adapter) — 3 tools: get_task, add_comment, set_status
│   │   └── rag.ts                ← Phase 2 stubs (searchDocsTool, searchCodeTool)
│   └── workflows/
│       └── review-task.ts        ← createReviewTaskWorkflow(config, adapter)
├── adapters/
│   ├── interface.ts              ← ProjectManagerAdapter, Task, TaskStatus types
│   ├── trello.ts                 ← TrelloAdapter (mock, task IDs: TRELLO-001, TRELLO-002)
│   └── asana.ts                  ← AsanaAdapter (mock, task IDs: ASANA-001, ASANA-002)
├── config/
│   └── project.ts                ← ProjectConfig interface + defaultProjectConfig
├── server.ts                     ← Express server, webhook handlers
└── index.ts                      ← Entry point, env validation, server startup
```

---

## Key Patterns

- **Adapter pattern:** All PM integrations implement `ProjectManagerAdapter` (`getTask`, `addComment`, `setStatus`). Adapters are mock-only; real API calls are TODOs.
- **Factory functions:** Agents, tools, and workflows are factories — not singletons. Always accept `(config, adapter)`.
- **Workflow:** Two steps — `checkDescription` (validates against `reviewCriteria`) → `analyzeOrRemind` (runs agent or posts reminder).
- **Tools have no business logic** — they only delegate to the adapter.

---

## Endpoints

```
POST /webhook/trello
POST /webhook/asana
GET  /health
```

Both webhook handlers delegate to `handleTaskEvent(taskId, adapter, config)`.

---

## Environment Variables

```env
ANTHROPIC_API_KEY=   # required
PORT=3000            # optional, default 3000
```

Phase 2 (not yet connected): `TRELLO_API_KEY`, `TRELLO_TOKEN`, `ASANA_TOKEN`

---

## What Is NOT Implemented (TODOs)

These are intentional — do not implement unless explicitly asked:

- Real Trello/Asana API calls (adapters are mocks)
- RAG / vector store (`rag.ts` stubs only)
- Webhook signature verification
- Persistent storage of analysis results
- Retry logic for failed agent runs
- Per-project config loading (single `defaultProjectConfig` in use)

---

## Dev Commands

```bash
npm run dev           # ts-node src/index.ts
npm run test:trello   # POST TRELLO-001 to local server
npm run test:asana    # POST ASANA-001 to local server
```
