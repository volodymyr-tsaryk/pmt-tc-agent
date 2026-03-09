# Dashboard Last Prompt Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the most recent prompt sent to the LLM in each agent card on the dashboard, truncated by default with an expand/collapse toggle.

**Architecture:** Add `lastPrompt: string | null` to `AgentStatus` in the event store; capture and store the prompt in the workflow just before calling `agent.generate()`; render a truncated snippet in the agent card with an inline expand toggle in `public/index.html`.

**Tech Stack:** TypeScript, Express, vanilla JS + DOM (no framework), in-memory store

---

### Task 1: Add `lastPrompt` field to `AgentStatus`

**Files:**
- Modify: `src/store/event-store.ts`

**Step 1: Add the field to the `AgentStatus` interface**

In `src/store/event-store.ts`, add `lastPrompt` to the interface and initialise it in `upsertAgentStatus`:

```ts
export interface AgentStatus {
  name: string;
  adapter: string;
  lastRunAt: string | null;
  lastStatus: AgentLastStatus;
  lastTaskId: string | null;
  lastPrompt: string | null;   // ← add this
}
```

In `upsertAgentStatus`, update the default object:

```ts
const existing = _agents.get(name) ?? {
  name,
  adapter: "",
  lastRunAt: null,
  lastStatus: "idle" as AgentLastStatus,
  lastTaskId: null,
  lastPrompt: null,            // ← add this
};
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

---

### Task 2: Store the prompt before calling `agent.generate()`

**Files:**
- Modify: `src/mastra/workflows/review-task.ts` — inside `analyzeOrRemind`, `passed` branch

**Step 1: Capture the prompt and upsert before generation**

In `analyzeOrRemind`, in the `if (passed)` branch, after building `userMessage` and before calling `agent.generate(userMessage)`, add:

```ts
const agentName = `TaskAnalyzer-${config.name}`;
upsertAgentStatus(agentName, { lastPrompt: userMessage });
```

`upsertAgentStatus` is already imported at the top of the file — no new import needed.

> Note: `agentName` is also constructed in `createReviewTaskWorkflow`'s closure. To avoid duplication, extract it as a parameter or just re-derive it the same way: `` `TaskAnalyzer-${config.name}` ``. Both are identical; pick whichever keeps the diff smallest.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

---

### Task 3: Render truncated prompt with expand/collapse in the dashboard

**Files:**
- Modify: `public/index.html` — `renderAgents` function and CSS

**Step 1: Add CSS for the prompt block**

Inside the `<style>` block, add:

```css
.agent-prompt {
  margin-top: 8px;
  font-size: 11px;
  color: #718096;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  line-height: 1.5;
  word-break: break-word;
}

.agent-prompt-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.agent-prompt-text.expanded {
  display: block;   /* removes the line-clamp */
}

.agent-prompt-toggle {
  display: inline-block;
  margin-top: 4px;
  font-size: 10px;
  color: #63b3ed;
  cursor: pointer;
  user-select: none;
}

.agent-prompt-toggle:hover { text-decoration: underline; }
```

**Step 2: Render the prompt block in `renderAgents`**

Inside the `agents.forEach` callback, after the `timeSpan` block and before `card.appendChild(meta)`, add:

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
    const expanded = promptText.classList.toggle('expanded');
    toggle.textContent = expanded ? 'show less' : 'show more';
  });

  promptBlock.appendChild(promptText);
  promptBlock.appendChild(toggle);
  card.appendChild(promptBlock);
}
```

**Step 3: Manual verification**

1. Start the server: `npm run dev`
2. Open `http://localhost:3000` in a browser
3. Trigger a webhook: `npm run test:trello` (or `npm run test:asana`)
4. Observe the agent card — it should show a 2-line truncated prompt with a "show more" link
5. Click "show more" — full prompt appears; link changes to "show less"
6. Click "show less" — collapses back

**Step 4: Edge-case check**

Trigger a webhook for a task with a very short description (fails `checkDescription`). The agent card should show no prompt block (since `lastPrompt` stays `null` when the task is rejected before reaching `agent.generate()`). Confirm the card renders without errors.

---

## What Is NOT in This Plan (YAGNI)

- Persisting prompts across server restarts — in-memory only, intentional
- Showing multiple historical prompts — only latest, intentional
- Showing the AI's response in the card — out of scope
- Auto-truncating in the store — truncation is display-layer only
