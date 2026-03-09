# Agent Run History — Design

**Goal:** Show the full step-by-step communication of each agent run (all runs, newest first, newest marked LATEST) in a modal on the dashboard.

**Polling:** 3-second poll is acceptable. Steps appear within 3s of each completing.

---

## Data Model

Two new types added to `src/store/event-store.ts`:

```ts
interface TraceStep {
  timestamp: string;
  assistantText: string;
  toolCalls: { toolName: string; args: unknown }[];
  toolResults: { toolName: string; result: unknown }[];
}

interface RunTrace {
  runId: string;          // timestamp string e.g. Date.now().toString()
  taskId: string;
  startedAt: string;
  completedAt: string | null;
  status: AgentLastStatus | null;
  userMessage: string;
  steps: TraceStep[];
}
```

`AgentStatus` changes:
- Add `runs: RunTrace[]` — capped at 20 per agent (oldest dropped when exceeded)
- Remove `lastPrompt: string | null` — redundant, covered by `runs[last].userMessage`

New store functions: `startRun`, `addRunStep`, `completeRun`.

---

## Capture Mechanism

Mastra's `agent.generate()` accepts `onStepFinish` in its options (type: `GenerateTextOnStepFinishCallback`). Each `StepResult` provides `text`, `toolCalls`, `toolResults`.

In `analyzeOrRemind` (passed branch):
1. Call `startRun(agentName, taskId, userMessage)` → returns `runId`
2. Pass `onStepFinish` to `agent.generate()` → calls `addRunStep` per step
3. After generate resolves, call `completeRun(agentName, runId, finalStatus)`

`agentName` is threaded into `analyzeOrRemind` as a parameter (fixes existing duplication).

Failed branch: call `startRun` + immediately `completeRun` with `needs_clarification` and no steps (no agent was invoked).

---

## API

No new endpoint. `/api/status` returns `AgentStatus[]` — `runs` is included automatically.

---

## Dashboard UI

- Sidebar card: "show more" link renamed to **"view history"**
- Modal: runs newest-first; newest has **"latest"** badge and is expanded by default
- Each run: collapsible section — header shows taskId, time, status badge
- Each run body (in order):
  - User message block (grey, monospace)
  - Per step:
    - Tool call row (yellow) — tool name + args as JSON
    - Tool result row (dim) — result as JSON
    - Assistant text block (teal/green)
- All content via `textContent` (no XSS risk)
