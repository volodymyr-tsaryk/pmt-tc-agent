# Agent Status UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a zero-dependency, polling status dashboard served at `GET /` showing agent statuses and a live log feed.

**Architecture:** A shared singleton `event-store.ts` captures log events and agent status updates written by the workflow. Express exposes `/api/status` and `/api/logs`. A single `public/index.html` polls those endpoints every 3 seconds and renders the dashboard. All dynamic content is HTML-escaped before insertion to prevent XSS.

**Tech Stack:** TypeScript, Express (already installed), vanilla HTML/CSS/JS (no build step), no new npm packages.

---

### Task 1: Create the event store

**Files:**
- Create: `src/store/event-store.ts`

**Step 1: Create the file with this exact content**

```typescript
// src/store/event-store.ts

export type LogLevel = "info" | "warn" | "error";
export type AgentLastStatus =
  | "idle"
  | "processing"
  | "plan_written"
  | "needs_clarification"
  | "error";

export interface LogEvent {
  id: number;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  taskId?: string;
  adapter?: string;
}

export interface AgentStatus {
  name: string;
  adapter: string;
  lastRunAt: string | null;
  lastStatus: AgentLastStatus;
  lastTaskId: string | null;
}

const MAX_EVENTS = 200;

let _nextId = 1;
const _events: LogEvent[] = [];
const _agents: Map<string, AgentStatus> = new Map();

export function logEvent(
  source: string,
  message: string,
  opts: { level?: LogLevel; taskId?: string; adapter?: string } = {}
): void {
  const event: LogEvent = {
    id: _nextId++,
    timestamp: new Date().toISOString(),
    level: opts.level ?? "info",
    source,
    message,
    taskId: opts.taskId,
    adapter: opts.adapter,
  };
  _events.push(event);
  if (_events.length > MAX_EVENTS) {
    _events.shift();
  }
}

export function getEvents(limit = 100): LogEvent[] {
  return _events.slice(-limit);
}

export function upsertAgentStatus(name: string, patch: Partial<AgentStatus>): void {
  const existing = _agents.get(name) ?? {
    name,
    adapter: "",
    lastRunAt: null,
    lastStatus: "idle" as AgentLastStatus,
    lastTaskId: null,
  };
  _agents.set(name, { ...existing, ...patch });
}

export function getAgentStatuses(): AgentStatus[] {
  return Array.from(_agents.values());
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/store/event-store.ts
git commit -m "feat: add in-memory event store with ring buffer"
```

---

### Task 2: Instrument the workflow

**Files:**
- Modify: `src/mastra/workflows/review-task.ts`

**Step 1: Add imports at the top of `review-task.ts`** (after existing imports)

```typescript
import { logEvent, upsertAgentStatus } from "../../store/event-store";
```

**Step 2: Replace the `console.log` in `checkDescription`**

Find:
```typescript
console.log(`[Workflow] checkDescription: fetching task ${taskId}`);
```
Replace with:
```typescript
logEvent("workflow", `checkDescription: fetching task ${taskId}`, { taskId });
```

**Step 3: Add logEvent calls before each return in `checkDescription`**

Before the `minDescriptionLength` return, add:
```typescript
logEvent("workflow", `description too short (${task.description.length} < ${minDescriptionLength})`, { taskId, level: "warn" });
```

Before the `requiredFields` return, add:
```typescript
logEvent("workflow", `missing required field: "${field}"`, { taskId, level: "warn" });
```

Before the final passing return, add:
```typescript
logEvent("workflow", "checkDescription passed", { taskId });
```

**Step 4: Replace console.log calls in `analyzeOrRemind`**

Find:
```typescript
console.log(`[Workflow] analyzeOrRemind: task ${taskId} passed — running agent`);
```
Replace with:
```typescript
logEvent("workflow", `task ${taskId} passed — running agent`, { taskId });
```

Find:
```typescript
console.log(`[Workflow] analyzeOrRemind: task ${taskId} did not pass — posting reminder`);
```
Replace with:
```typescript
logEvent("workflow", `task ${taskId} did not pass — posting reminder`, { taskId, level: "warn" });
```

After `await agent.generate(...)`, add:
```typescript
logEvent("agent", `generated response for task ${taskId}`, { taskId });
```

**Step 5: Replace the `run()` method body in the exported factory**

The final `createReviewTaskWorkflow` function should look like this:

```typescript
export function createReviewTaskWorkflow(
  config: ProjectConfig,
  adapter: ProjectManagerAdapter
) {
  const adapterName = adapter.source;
  const agentName = `TaskAnalyzer-${config.name}`;

  return {
    async run(taskId: string): Promise<void> {
      upsertAgentStatus(agentName, {
        adapter: adapterName,
        lastStatus: "processing",
        lastRunAt: new Date().toISOString(),
        lastTaskId: taskId,
      });
      logEvent("workflow", `started review for ${taskId}`, { taskId, adapter: adapterName });

      const checkResult = await checkDescription(taskId, adapter, config);
      logEvent("workflow", `checkDescription: passed=${checkResult.passed}, reason="${checkResult.reason}"`, { taskId });

      await analyzeOrRemind(checkResult, adapter, config);

      const finalStatus = checkResult.passed ? "plan_written" : "needs_clarification";
      upsertAgentStatus(agentName, { lastStatus: finalStatus });
      logEvent("workflow", `completed — status: ${finalStatus}`, { taskId, adapter: adapterName });
    },
  };
}
```

**Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 7: Commit**

```bash
git add src/mastra/workflows/review-task.ts
git commit -m "feat: instrument workflow with event store logging"
```

---

### Task 3: Add API endpoints and static serving to Express

**Files:**
- Modify: `src/server.ts`

**Step 1: Add imports at the top of `server.ts`** (after existing imports)

```typescript
import path from "path";
import { getEvents, getAgentStatuses } from "./store/event-store";
```

**Step 2: Inside `createServer()`, after `app.use(express.json())`, add static serving**

```typescript
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});
```

**Step 3: After the `/health` route, add the two API routes**

```typescript
app.get("/api/status", (_req: Request, res: Response) => {
  res.json(getAgentStatuses());
});

app.get("/api/logs", (_req: Request, res: Response) => {
  res.json(getEvents(100));
});
```

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: add /api/status, /api/logs endpoints and static serving"
```

---

### Task 4: Create the dashboard HTML

**Files:**
- Create: `public/index.html`

> **Security note:** All dynamic server data is escaped via `escHtml()` before DOM insertion. Use `textContent` for plain strings and `escHtml()` + template literals for structured HTML to avoid XSS.

**Step 1: Create the `public/` directory**

```bash
mkdir public
```

**Step 2: Create `public/index.html` with this exact content**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Task Analyzer Agent</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #0f1117;
      color: #e2e8f0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 20px;
      background: #1a1d27;
      border-bottom: 1px solid #2d3748;
      flex-shrink: 0;
    }

    header h1 { font-size: 16px; font-weight: 600; color: #f8fafc; }

    .live-badge {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: #68d391;
      margin-left: auto;
    }

    .live-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #68d391;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .layout {
      display: grid;
      grid-template-columns: 240px 1fr;
      flex: 1;
      overflow: hidden;
    }

    .sidebar {
      background: #1a1d27;
      border-right: 1px solid #2d3748;
      padding: 16px 12px;
      overflow-y: auto;
    }

    .sidebar-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: #718096;
      text-transform: uppercase;
      margin-bottom: 12px;
      padding: 0 4px;
    }

    .agent-card {
      background: #242736;
      border: 1px solid #2d3748;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
    }

    .agent-card:last-child { margin-bottom: 0; }

    .agent-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .status-dot {
      width: 9px; height: 9px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .dot-idle                { background: #4a5568; }
    .dot-processing          { background: #ecc94b; animation: pulse 1s infinite; }
    .dot-plan_written        { background: #68d391; }
    .dot-needs_clarification { background: #ed8936; }
    .dot-error               { background: #fc8181; }

    .agent-name { font-size: 13px; font-weight: 600; color: #f8fafc; }

    .agent-meta { font-size: 11px; color: #718096; line-height: 1.8; }

    .status-label {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .label-idle                { background: #2d3748; color: #718096; }
    .label-processing          { background: #744210; color: #ecc94b; }
    .label-plan_written        { background: #1c4532; color: #68d391; }
    .label-needs_clarification { background: #7b341e; color: #ed8936; }
    .label-error               { background: #742a2a; color: #fc8181; }

    .log-panel {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .log-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid #2d3748;
      flex-shrink: 0;
    }

    .log-header-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: #718096;
      text-transform: uppercase;
    }

    .log-feed {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 12px;
    }

    .log-feed::-webkit-scrollbar { width: 4px; }
    .log-feed::-webkit-scrollbar-track { background: transparent; }
    .log-feed::-webkit-scrollbar-thumb { background: #2d3748; border-radius: 2px; }

    .log-entry {
      display: grid;
      grid-template-columns: 80px 80px 1fr;
      gap: 8px;
      padding: 3px 16px;
      line-height: 1.6;
      border-left: 2px solid transparent;
    }

    .log-entry:hover { background: #1a1d27; }
    .log-entry.level-warn  { border-left-color: #ed8936; }
    .log-entry.level-error { border-left-color: #fc8181; }

    .log-time    { color: #4a5568; }
    .log-source  { color: #9f7aea; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .log-message { color: #cbd5e0; word-break: break-word; }
    .log-taskid  { color: #63b3ed; font-weight: 600; margin-right: 4px; }

    .log-entry.level-warn  .log-message { color: #ecc94b; }
    .log-entry.level-error .log-message { color: #fc8181; }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #4a5568;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <header>
    <h1>Task Analyzer Agent</h1>
    <div class="live-badge">
      <div class="live-dot"></div>
      <span>live</span>
    </div>
  </header>

  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-label">Agents</div>
      <div id="agents-container"></div>
    </aside>

    <section class="log-panel">
      <div class="log-header">
        <span class="log-header-label">Log Feed</span>
        <span id="log-count" style="font-size:11px;color:#4a5568;">— events</span>
      </div>
      <div class="log-feed" id="log-feed">
        <div class="empty-state">Waiting for events…</div>
      </div>
    </section>
  </div>

  <script>
    // Escape HTML to prevent XSS — all dynamic data from the server goes through this
    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    const POLL_INTERVAL = 3000;
    let lastLogId = 0;
    let autoScroll = true;

    function formatTime(iso) {
      return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
    }

    function renderAgents(agents) {
      const container = document.getElementById('agents-container');
      container.textContent = ''; // clear safely

      if (!agents.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.style.height = '80px';
        empty.textContent = 'No agents registered yet';
        container.appendChild(empty);
        return;
      }

      agents.forEach(function(a) {
        const card = document.createElement('div');
        card.className = 'agent-card';

        const header = document.createElement('div');
        header.className = 'agent-header';

        const dot = document.createElement('div');
        dot.className = 'status-dot dot-' + escHtml(a.lastStatus);

        const name = document.createElement('div');
        name.className = 'agent-name';
        name.textContent = a.adapter || a.name;

        header.appendChild(dot);
        header.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'agent-meta';

        const agentNameSpan = document.createElement('span');
        agentNameSpan.textContent = a.name;

        const statusBadge = document.createElement('span');
        statusBadge.className = 'status-label label-' + escHtml(a.lastStatus);
        statusBadge.textContent = a.lastStatus.replace(/_/g, ' ');

        meta.appendChild(agentNameSpan);
        meta.appendChild(document.createElement('br'));
        meta.appendChild(statusBadge);

        if (a.lastTaskId) {
          const taskSpan = document.createElement('span');
          taskSpan.textContent = 'Task: ' + a.lastTaskId;
          meta.appendChild(taskSpan);
        }

        const timeSpan = document.createElement('span');
        timeSpan.textContent = a.lastRunAt ? formatTime(a.lastRunAt) : 'never run';
        meta.appendChild(timeSpan);

        card.appendChild(header);
        card.appendChild(meta);
        container.appendChild(card);
      });
    }

    function renderLogs(events) {
      const feed = document.getElementById('log-feed');
      const countEl = document.getElementById('log-count');

      const newEvents = events.filter(function(e) { return e.id > lastLogId; });
      if (!newEvents.length) return;

      // Remove empty state placeholder if present
      const empty = feed.querySelector('.empty-state');
      if (empty) empty.remove();

      newEvents.forEach(function(e) {
        if (e.id > lastLogId) lastLogId = e.id;

        const row = document.createElement('div');
        row.className = 'log-entry level-' + e.level;

        const timeCell = document.createElement('span');
        timeCell.className = 'log-time';
        timeCell.textContent = formatTime(e.timestamp);

        const sourceCell = document.createElement('span');
        sourceCell.className = 'log-source';
        sourceCell.textContent = '[' + e.source + ']';

        const msgCell = document.createElement('span');
        msgCell.className = 'log-message';

        if (e.taskId) {
          const taskTag = document.createElement('span');
          taskTag.className = 'log-taskid';
          taskTag.textContent = e.taskId;
          msgCell.appendChild(taskTag);
        }

        const msgText = document.createTextNode(e.message);
        msgCell.appendChild(msgText);

        row.appendChild(timeCell);
        row.appendChild(sourceCell);
        row.appendChild(msgCell);
        feed.appendChild(row);
      });

      countEl.textContent = events.length + ' events';

      if (autoScroll) {
        feed.scrollTop = feed.scrollHeight;
      }
    }

    document.getElementById('log-feed').addEventListener('scroll', function() {
      autoScroll = this.scrollTop + this.clientHeight >= this.scrollHeight - 10;
    });

    async function poll() {
      try {
        const [statusRes, logsRes] = await Promise.all([
          fetch('/api/status'),
          fetch('/api/logs'),
        ]);
        renderAgents(await statusRes.json());
        renderLogs(await logsRes.json());
      } catch (err) {
        console.error('Poll error:', err);
      }
    }

    poll();
    setInterval(poll, POLL_INTERVAL);
  </script>
</body>
</html>
```

**Step 3: Verify the file exists**

```bash
ls public/index.html
```

**Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add agent status dashboard UI"
```

---

### Task 5: Register agents in event store at startup

**Files:**
- Modify: `src/mastra/index.ts`

**Step 1: Add import**

```typescript
import { upsertAgentStatus } from "../store/event-store";
```

**Step 2: After the `mastra` export, add registration calls**

```typescript
upsertAgentStatus(trelloAgent.name, {
  name: trelloAgent.name,
  adapter: "trello",
  lastStatus: "idle",
  lastRunAt: null,
  lastTaskId: null,
});

upsertAgentStatus(asanaAgent.name, {
  name: asanaAgent.name,
  adapter: "asana",
  lastStatus: "idle",
  lastRunAt: null,
  lastTaskId: null,
});
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/mastra/index.ts
git commit -m "feat: register agents in event store at startup"
```

---

### Task 6: End-to-end verification

**Step 1: Start the server**

```bash
npm run dev
```

Expected:
```
[Agent] Server running on http://localhost:3000
[Agent] Webhooks:
  POST http://localhost:3000/webhook/trello
  POST http://localhost:3000/webhook/asana
```

**Step 2: Open the dashboard**

Open `http://localhost:3000` in a browser.

Expected: two agent cards (Trello, Asana) both showing status "idle". Log feed shows "Waiting for events…".

**Step 3: Fire a Trello webhook**

```bash
npm run test:trello
```

Expected in browser within 3 seconds: log entries appear in the feed, Trello agent card updates to "plan_written" or "needs_clarification".

**Step 4: Verify API endpoints**

```bash
curl -s http://localhost:3000/api/status
curl -s http://localhost:3000/api/logs
```

Expected: valid JSON arrays.

**Step 5: Verify health endpoint unchanged**

```bash
curl -s http://localhost:3000/health
```

Expected: `{"status":"ok","adapters":["trello","asana"]}`
