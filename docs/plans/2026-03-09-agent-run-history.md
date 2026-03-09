# Agent Run History Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single `lastPrompt` field with a full per-agent run history (up to 20 runs), each storing the user message and every agent step (tool calls + assistant replies), shown in a modal newest-first with the latest run expanded and marked "LATEST".

**Architecture:** Extend the in-memory `AgentStatus` with a `runs: RunTrace[]` array (capped at 20). Capture steps incrementally via Mastra's `onStepFinish` callback during `agent.generate()`. The existing 3-second `/api/status` poll delivers the trace to the dashboard; no new endpoints needed.

**Tech Stack:** TypeScript, `@mastra/core` Agent, AI SDK `StepResult`, Express, vanilla JS

---

### Task 1: Add run history types and store functions to `event-store.ts`

**Files:**
- Modify: `src/store/event-store.ts`

This task replaces `lastPrompt: string | null` on `AgentStatus` with `runs: RunTrace[]` and adds three new store functions.

**Step 1: Add `TraceStep` and `RunTrace` interfaces**

Insert these two interfaces just before the `AgentStatus` interface:

```ts
export interface TraceStep {
  timestamp: string;
  assistantText: string;
  toolCalls: Array<{ toolName: string; args: unknown }>;
  toolResults: Array<{ toolName: string; result: unknown }>;
}

export interface RunTrace {
  runId: string;
  taskId: string;
  startedAt: string;
  completedAt: string | null;
  status: AgentLastStatus | null;
  userMessage: string;
  steps: TraceStep[];
}
```

**Step 2: Update `AgentStatus` interface**

Remove `lastPrompt: string | null` and add `runs: RunTrace[]`:

```ts
export interface AgentStatus {
  name: string;
  adapter: string;
  lastRunAt: string | null;
  lastStatus: AgentLastStatus;
  lastTaskId: string | null;
  runs: RunTrace[];
}
```

**Step 3: Add `MAX_RUNS_PER_AGENT` constant**

Add alongside the existing `MAX_EVENTS = 200` constant:

```ts
const MAX_RUNS_PER_AGENT = 20;
```

**Step 4: Update `upsertAgentStatus` default object**

Replace `lastPrompt: null` with `runs: []`:

```ts
const existing = _agents.get(name) ?? {
  name,
  adapter: "",
  lastRunAt: null,
  lastStatus: "idle" as AgentLastStatus,
  lastTaskId: null,
  runs: [],
};
```

**Step 5: Add `startRun`, `addRunStep`, `completeRun` functions**

Append these three functions at the end of the file:

```ts
export function startRun(
  agentName: string,
  taskId: string,
  userMessage: string
): string {
  const runId = Date.now().toString();
  const existing = _agents.get(agentName) ?? {
    name: agentName,
    adapter: "",
    lastRunAt: null,
    lastStatus: "idle" as AgentLastStatus,
    lastTaskId: null,
    runs: [],
  };

  const newRun: RunTrace = {
    runId,
    taskId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: null,
    userMessage,
    steps: [],
  };

  const runs = [...existing.runs, newRun];
  if (runs.length > MAX_RUNS_PER_AGENT) {
    runs.splice(0, runs.length - MAX_RUNS_PER_AGENT);
  }

  _agents.set(agentName, { ...existing, runs });
  return runId;
}

export function addRunStep(
  agentName: string,
  runId: string,
  step: TraceStep
): void {
  const agent = _agents.get(agentName);
  if (!agent) return;

  const runs = agent.runs.map((r) =>
    r.runId === runId ? { ...r, steps: [...r.steps, step] } : r
  );
  _agents.set(agentName, { ...agent, runs });
}

export function completeRun(
  agentName: string,
  runId: string,
  status: AgentLastStatus
): void {
  const agent = _agents.get(agentName);
  if (!agent) return;

  const runs = agent.runs.map((r) =>
    r.runId === runId
      ? { ...r, completedAt: new Date().toISOString(), status }
      : r
  );
  _agents.set(agentName, { ...agent, runs });
}
```

**Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors (there will be errors in `review-task.ts` because `lastPrompt` is referenced — that's fine, Task 2 fixes those).

Actually TypeScript WILL error on the files that reference `lastPrompt`. Run just the store file in isolation is not possible with `tsc --noEmit` (it checks everything). **Skip the tsc check here and run it after Task 2 is complete.**

---

### Task 2: Update `review-task.ts` to capture run history

**Files:**
- Modify: `src/mastra/workflows/review-task.ts`

**Step 1: Update imports**

The file already imports `logEvent` and `upsertAgentStatus` from `../../store/event-store`. Add the new functions:

```ts
import { logEvent, upsertAgentStatus, startRun, addRunStep, completeRun } from "../../store/event-store";
```

Remove the import of `TraceStep` — it's not needed directly; the inline object literal is enough.

**Step 2: Add `agentName` parameter to `analyzeOrRemind`**

Change the function signature from:

```ts
async function analyzeOrRemind(
  result: CheckDescriptionResult,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig,
  triggerContext?: TriggerContext
): Promise<void> {
```

To:

```ts
async function analyzeOrRemind(
  result: CheckDescriptionResult,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig,
  agentName: string,
  triggerContext?: TriggerContext
): Promise<string> {
```

Note the return type changes from `Promise<void>` to `Promise<string>` — it returns the `runId`.

**Step 3: Replace the `passed` branch body**

Current passed branch:

```ts
if (passed) {
  logEvent("workflow", `task ${taskId} passed — running agent`, { taskId });
  const agent = createTaskAnalyzerAgent(config, adapter);
  const userMessage =
    triggerContext?.triggerType === "comment"
      ? buildConversationPrompt(task, triggerContext)
      : buildAnalysisPrompt(task);
  upsertAgentStatus(`TaskAnalyzer-${config.name}`, { lastPrompt: userMessage });
  await agent.generate(userMessage);
  logEvent("agent", `generated response for task ${taskId}`, { taskId });
```

Replace with:

```ts
if (passed) {
  logEvent("workflow", `task ${taskId} passed — running agent`, { taskId });
  const agent = createTaskAnalyzerAgent(config, adapter);
  const userMessage =
    triggerContext?.triggerType === "comment"
      ? buildConversationPrompt(task, triggerContext)
      : buildAnalysisPrompt(task);

  const runId = startRun(agentName, taskId, userMessage);

  await agent.generate(userMessage, {
    onStepFinish: (step: unknown) => {
      const s = step as {
        text?: string;
        toolCalls?: Array<{ toolName: string; args: unknown }>;
        toolResults?: Array<{ toolName: string; result: unknown }>;
      };
      addRunStep(agentName, runId, {
        timestamp: new Date().toISOString(),
        assistantText: s.text ?? "",
        toolCalls: (s.toolCalls ?? []).map((tc) => ({
          toolName: tc.toolName,
          args: tc.args,
        })),
        toolResults: (s.toolResults ?? []).map((tr) => ({
          toolName: tr.toolName,
          result: tr.result,
        })),
      });
    },
  });

  logEvent("agent", `generated response for task ${taskId}`, { taskId });
  return runId;
```

**Step 4: Replace the `else` branch body**

Current:

```ts
  } else {
    logEvent("workflow", `task ${taskId} did not pass — posting reminder`, { taskId, level: "warn" });
    const reminder = ...;
    upsertAgentStatus(`TaskAnalyzer-${config.name}`, { lastPrompt: null });
    await adapter.addComment(taskId, reminder);
    await adapter.setStatus(taskId, "needs_clarification");
  }
```

Replace with:

```ts
  } else {
    logEvent("workflow", `task ${taskId} did not pass — posting reminder`, { taskId, level: "warn" });
    const reminder =
      `[TaskAnalyzer] This task needs more detail before it can be developed.\n\n` +
      `Reason: ${reason}\n\n` +
      `Please update the task description (minimum ${config.reviewCriteria.minDescriptionLength} characters) ` +
      `and ensure the following fields are filled in: ${config.reviewCriteria.requiredFields.join(", ")}.`;

    const runId = startRun(agentName, taskId, "");
    await adapter.addComment(taskId, reminder);
    await adapter.setStatus(taskId, "needs_clarification");
    return runId;
  }
```

**Step 5: Update the call site in `createReviewTaskWorkflow`**

Find the `analyzeOrRemind` call inside `workflow.run()`:

```ts
await analyzeOrRemind(checkResult, adapter, config, triggerContext);

const finalStatus = checkResult.passed ? "plan_written" : "needs_clarification";
upsertAgentStatus(agentName, { lastStatus: finalStatus });
```

Replace with:

```ts
const runId = await analyzeOrRemind(checkResult, adapter, config, agentName, triggerContext);

const finalStatus = checkResult.passed ? "plan_written" : "needs_clarification";
completeRun(agentName, runId, finalStatus);
upsertAgentStatus(agentName, { lastStatus: finalStatus });
```

**Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors. Fix any errors before proceeding.

---

### Task 3: Update the dashboard to show run history in the modal

**Files:**
- Modify: `public/index.html`

This task makes three changes: (a) removes the sidebar prompt snippet, (b) replaces it with a "view history" link, (c) rewrites the modal to render `a.runs`.

**Step 1: Replace the agent-prompt CSS block**

Find and remove these CSS rules entirely (they were for the sidebar snippet):

```css
.agent-prompt { ... }
.agent-prompt-text { ... }
.agent-prompt-toggle { ... }
.agent-prompt-toggle:hover { ... }
```

Replace with CSS for the run history modal content:

```css
.view-history-link {
  display: inline-block;
  margin-top: 8px;
  font-size: 10px;
  color: #63b3ed;
  cursor: pointer;
  user-select: none;
}

.view-history-link:hover { text-decoration: underline; }

.run-list { display: flex; flex-direction: column; gap: 12px; }

.run-section {
  border: 1px solid #2d3748;
  border-radius: 6px;
  overflow: hidden;
}

.run-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #242736;
  cursor: pointer;
  user-select: none;
  font-size: 11px;
}

.run-header:hover { background: #2d3244; }

.run-latest-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  background: #2b4c7e;
  color: #63b3ed;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.run-task-id { color: #63b3ed; font-weight: 600; }

.run-time { color: #4a5568; margin-left: auto; }

.run-body {
  display: none;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 11px;
}

.run-body.collapsed { display: none; }

.step-user {
  background: #1a202c;
  border-left: 3px solid #4a5568;
  padding: 6px 10px;
  color: #a0aec0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.step-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 3px;
}

.step-tool-call {
  background: #2d2000;
  border-left: 3px solid #ecc94b;
  padding: 6px 10px;
  color: #ecc94b;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.step-tool-result {
  background: #1a1d27;
  border-left: 3px solid #4a5568;
  padding: 6px 10px;
  color: #718096;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.step-assistant {
  background: #0d2137;
  border-left: 3px solid #4299e1;
  padding: 6px 10px;
  color: #90cdf4;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
```

**Step 2: Update the modal HTML**

Find the existing modal HTML:

```html
<div class="modal-overlay" id="prompt-modal">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title">Last Prompt</span>
      <span class="modal-close" id="modal-close">✕</span>
    </div>
    <div class="modal-body" id="modal-body"></div>
  </div>
</div>
```

Replace with (just the title changes):

```html
<div class="modal-overlay" id="prompt-modal">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title" id="modal-title">Run History</span>
      <span class="modal-close" id="modal-close">✕</span>
    </div>
    <div class="modal-body" id="modal-body"></div>
  </div>
</div>
```

**Step 3: Replace `openPromptModal` with `openHistoryModal`**

Find:

```js
function openPromptModal(text) {
  modalBody.textContent = text;
  promptModal.classList.add('open');
}
```

Replace with:

```js
function openHistoryModal(agent) {
  document.getElementById('modal-title').textContent =
    (agent.adapter || agent.name) + ' — Run History';
  modalBody.textContent = '';

  const runs = (agent.runs || []).slice().reverse(); // newest first

  if (!runs.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:#4a5568;font-size:13px;padding:16px;text-align:center;';
    empty.textContent = 'No runs yet.';
    modalBody.appendChild(empty);
    promptModal.classList.add('open');
    return;
  }

  const list = document.createElement('div');
  list.className = 'run-list';

  runs.forEach(function (run, idx) {
    const isLatest = idx === 0;

    const section = document.createElement('div');
    section.className = 'run-section';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'run-header';

    if (isLatest) {
      const badge = document.createElement('span');
      badge.className = 'run-latest-badge';
      badge.textContent = 'latest';
      hdr.appendChild(badge);
    }

    const taskSpan = document.createElement('span');
    taskSpan.className = 'run-task-id';
    taskSpan.textContent = run.taskId;

    const statusBadge = document.createElement('span');
    statusBadge.className = 'status-label label-' + escHtml(run.status || 'idle');
    statusBadge.textContent = (run.status || 'running').replace(/_/g, ' ');

    const timeSpan = document.createElement('span');
    timeSpan.className = 'run-time';
    timeSpan.textContent = formatTime(run.startedAt);

    hdr.appendChild(taskSpan);
    hdr.appendChild(statusBadge);
    hdr.appendChild(timeSpan);

    // Body
    const body = document.createElement('div');
    body.className = isLatest ? 'run-body' : 'run-body collapsed';

    // User message
    if (run.userMessage) {
      const userBlock = document.createElement('div');
      userBlock.className = 'step-user';
      const lbl = document.createElement('div');
      lbl.className = 'step-label';
      lbl.textContent = 'User message';
      const txt = document.createElement('div');
      txt.textContent = run.userMessage;
      userBlock.appendChild(lbl);
      userBlock.appendChild(txt);
      body.appendChild(userBlock);
    }

    // Steps
    run.steps.forEach(function (step) {
      // Tool calls
      step.toolCalls.forEach(function (tc) {
        const block = document.createElement('div');
        block.className = 'step-tool-call';
        const lbl = document.createElement('div');
        lbl.className = 'step-label';
        lbl.textContent = 'Tool call: ' + tc.toolName;
        const txt = document.createElement('div');
        txt.textContent = JSON.stringify(tc.args, null, 2);
        block.appendChild(lbl);
        block.appendChild(txt);
        body.appendChild(block);
      });

      // Tool results
      step.toolResults.forEach(function (tr) {
        const block = document.createElement('div');
        block.className = 'step-tool-result';
        const lbl = document.createElement('div');
        lbl.className = 'step-label';
        lbl.textContent = 'Result: ' + tr.toolName;
        const txt = document.createElement('div');
        txt.textContent = JSON.stringify(tr.result, null, 2);
        block.appendChild(lbl);
        block.appendChild(txt);
        body.appendChild(block);
      });

      // Assistant text
      if (step.assistantText) {
        const block = document.createElement('div');
        block.className = 'step-assistant';
        const lbl = document.createElement('div');
        lbl.className = 'step-label';
        lbl.textContent = 'Assistant';
        const txt = document.createElement('div');
        txt.textContent = step.assistantText;
        block.appendChild(lbl);
        block.appendChild(txt);
        body.appendChild(block);
      }
    });

    // Toggle collapse on header click
    hdr.addEventListener('click', function () {
      body.classList.toggle('collapsed');
    });

    section.appendChild(hdr);
    section.appendChild(body);
    list.appendChild(section);
  });

  modalBody.appendChild(list);
  promptModal.classList.add('open');
}
```

**Step 4: Update the `renderAgents` prompt block**

Find the existing `if (a.lastPrompt)` block in `renderAgents`:

```js
if (a.lastPrompt) {
  const promptBlock = document.createElement('div');
  promptBlock.className = 'agent-prompt';

  const promptText = document.createElement('div');
  promptText.className = 'agent-prompt-text';
  promptText.textContent = a.lastPrompt;

  const toggle = document.createElement('span');
  toggle.className = 'agent-prompt-toggle';
  toggle.textContent = 'show more';
  toggle.addEventListener('click', function () {
    openPromptModal(a.lastPrompt);
  });

  promptBlock.appendChild(promptText);
  promptBlock.appendChild(toggle);
  card.appendChild(promptBlock);
}
```

Replace with:

```js
if (a.runs && a.runs.length) {
  const link = document.createElement('span');
  link.className = 'view-history-link';
  link.textContent = 'view history (' + a.runs.length + ')';
  link.addEventListener('click', function () {
    openHistoryModal(a);
  });
  card.appendChild(link);
}
```

**Step 5: Manual verification**

1. Start the server: `npm run dev`
2. Open `http://localhost:3000`
3. Trigger a webhook: `npm run test:trello`
4. Agent card should show `view history (1)` link
5. Click it — modal opens with one run (marked "LATEST"), user message block, tool call rows, assistant reply
6. Trigger a second webhook: `npm run test:asana`
7. Click "view history" — modal shows 2 runs, newest (LATEST) expanded, older collapsed
8. Click the older run header — it expands; click again — collapses

---

## What Is NOT in This Plan (YAGNI)

- Persisting run history across server restarts — in-memory only, intentional
- Token-level streaming — 3s poll is sufficient
- Pagination of runs beyond 20 — cap is sufficient
- Filtering runs by status — out of scope
