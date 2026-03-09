# Conversation Threading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the agent to read the full GitHub comment thread and the triggering `@task-ai` comment so it can answer questions, process clarifying-question answers, and offer to revise dev plans — instead of re-analyzing from scratch every time.

**Architecture:** A typed `TriggerContext` object is constructed in the `issue_comment` webhook handler (where we already have the comment body and can call `githubAdapter.getComments`), then passed down through `handleTaskEvent` → `workflow.run` → `analyzeOrRemind` → agent prompt. Label triggers pass no `TriggerContext` and are completely unaffected. The agent system prompt gains a `CONVERSATION MODE` section that governs how it responds when thread context is present.

**Tech Stack:** TypeScript, `@octokit/rest@20` (paginate for full thread), Mastra agent, existing Express webhook infrastructure.

**Design doc:** `docs/plans/2026-03-09-conversation-threading-design.md`

---

## Task 1: Add `ThreadComment` and `TriggerContext` types

**Files:**
- Modify: `src/adapters/interface.ts`

**Step 1: Read the current file**

Read `src/adapters/interface.ts`. It currently ends after the `ProjectManagerAdapter` interface.

**Step 2: Append the two new types at the end of the file**

```ts
export interface ThreadComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface TriggerContext {
  triggerType: "label" | "comment";
  triggerComment?: {
    body: string;
    author: string;
  };
  thread?: ThreadComment[];
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/adapters/interface.ts
git commit -m "feat: add ThreadComment and TriggerContext types"
```

---

## Task 2: Add `getComments` to `GitHubAdapter`

**Files:**
- Modify: `src/adapters/github.ts`

**Step 1: Read the current file**

Read `src/adapters/github.ts`. The import on line 3 currently reads:
```ts
import { ProjectManagerAdapter, Task, TaskStatus } from "./interface";
```

**Step 2: Add `ThreadComment` to the import**

```ts
import { ProjectManagerAdapter, Task, TaskStatus, ThreadComment } from "./interface";
```

**Step 3: Add `getComments` as a public method after `fetchRepoConfig`**

```ts
async getComments(taskId: string): Promise<ThreadComment[]> {
  console.log(`[GitHubAdapter] getComments("${taskId}")`);
  const { owner, repo, issueNumber } = this.parseTaskId(taskId);

  // TODO: switch to smart window (first bot comment + last N) when threads grow large
  const comments = await this.octokit.paginate(
    this.octokit.rest.issues.listComments,
    { owner, repo, issue_number: issueNumber, per_page: 100 }
  );

  return comments.map((c) => ({
    author: c.user?.login ?? "unknown",
    body: c.body ?? "",
    createdAt: c.created_at,
  }));
}
```

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. If `octokit.paginate` has a type error with `listComments`, the fix is:
```ts
const { data: comments } = await this.octokit.rest.issues.listComments({
  owner, repo, issue_number: issueNumber, per_page: 100,
});
```
(falls back to single-page, 100 comments max — acceptable as first implementation)

**Step 5: Commit**

```bash
git add src/adapters/github.ts
git commit -m "feat: add GitHubAdapter.getComments for full thread fetch"
```

---

## Task 3: Update `server.ts` — loop prevention, thread fetch, TriggerContext

**Files:**
- Modify: `src/server.ts`

**Step 1: Read the current file**

Read `src/server.ts` in full to understand the exact current state of the `issue_comment` handler and `handleTaskEvent`.

**Step 2: Add `TriggerContext` to the import from `./adapters/interface`**

Find the line:
```ts
import { ProjectManagerAdapter } from "./adapters/interface";
```

Change to:
```ts
import { ProjectManagerAdapter, TriggerContext } from "./adapters/interface";
```

**Step 3: Update `handleTaskEvent` signature to accept optional `triggerContext`**

Find:
```ts
async function handleTaskEvent(
  taskId: string,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig
): Promise<void> {
  const workflow = createReviewTaskWorkflow(config, adapter);
  await workflow.run(taskId);
}
```

Replace with:
```ts
async function handleTaskEvent(
  taskId: string,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig,
  triggerContext?: TriggerContext
): Promise<void> {
  const workflow = createReviewTaskWorkflow(config, adapter);
  await workflow.run(taskId, triggerContext);
}
```

**Step 4: Update the `issue_comment` payload type to include `sender`**

Find the payload type cast inside the `issue_comment` branch:
```ts
const payload = req.body as {
  action: string;
  comment: { body: string };
  issue: { number: number };
  repository: { name: string; owner: { login: string } };
};
```

Replace with:
```ts
const payload = req.body as {
  action: string;
  comment: { body: string };
  issue: { number: number };
  repository: { name: string; owner: { login: string } };
  sender: { login: string };
};
```

**Step 5: Add loop prevention after the mention check**

The `issue_comment` handler currently has this order:
1. Check `action === "created"` and mention present → else 200 ignored
2. Check malformed payload → else 400
3. Extract owner/repo/taskId
4. Send 202
5. Inner try: fetch config + handleTaskEvent

After step 1 (the mention check, currently lines ending with `return;` after the first `if` block), add loop prevention:

```ts
// Loop prevention: ignore comments posted by the bot itself
if (
  process.env.GITHUB_BOT_USERNAME &&
  payload.sender?.login === process.env.GITHUB_BOT_USERNAME
) {
  res.status(200).json({ status: "ignored" });
  return;
}
```

**Step 6: Update the inner try/catch to fetch thread and build TriggerContext**

Find the inner try/catch block (currently):
```ts
res.status(202).json({ status: "accepted", taskId });
try {
  const config = await githubAdapter.fetchRepoConfig(owner, repo);
  await handleTaskEvent(taskId, githubAdapter, config);
} catch (innerError) {
  console.error(`[Server] GitHub task processing failed for ${taskId}:`, innerError);
}
```

Replace with:
```ts
res.status(202).json({ status: "accepted", taskId });
try {
  const config = await githubAdapter.fetchRepoConfig(owner, repo);
  const thread = await githubAdapter.getComments(taskId);
  const triggerContext: TriggerContext = {
    triggerType: "comment",
    triggerComment: {
      body: payload.comment.body,
      author: payload.sender.login,
    },
    thread,
  };
  await handleTaskEvent(taskId, githubAdapter, config, triggerContext);
} catch (innerError) {
  console.error(`[Server] GitHub task processing failed for ${taskId}:`, innerError);
}
```

**Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 8: Commit**

```bash
git add src/server.ts
git commit -m "feat: pass TriggerContext through handleTaskEvent for comment threading"
```

---

## Task 4: Update `review-task.ts` — prompt builders and triggerContext threading

**Files:**
- Modify: `src/mastra/workflows/review-task.ts`

**Step 1: Read the current file**

Read `src/mastra/workflows/review-task.ts` in full.

**Step 2: Add `TriggerContext` and `ThreadComment` imports**

The current import on line 4:
```ts
import { ProjectManagerAdapter, Task } from "../../adapters/interface";
```

Change to:
```ts
import { ProjectManagerAdapter, Task, TriggerContext, ThreadComment } from "../../adapters/interface";
```

**Step 3: Add the two prompt builder functions before `analyzeOrRemind`**

Add these functions after the `CheckDescriptionResult` interface definition and before `checkDescription`:

```ts
function buildAnalysisPrompt(task: Task): string {
  return [
    "Please analyze this task and produce either a Development Plan or Clarifying Questions.",
    "",
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Description: ${task.description}`,
  ].join("\n");
}

function formatThreadComment(c: ThreadComment): string {
  return `[${c.author}] ${c.createdAt}: ${c.body}`;
}

function buildConversationPrompt(task: Task, triggerContext: TriggerContext): string {
  const threadLines = (triggerContext.thread ?? [])
    .map(formatThreadComment)
    .join("\n\n");

  return [
    "TASK:",
    `ID: ${task.id}`,
    `Title: ${task.title}`,
    `Description: ${task.description}`,
    "",
    "COMMENT THREAD (oldest first):",
    threadLines || "(no previous comments)",
    "",
    `TRIGGERING COMMENT (by ${triggerContext.triggerComment?.author ?? "unknown"}):`,
    triggerContext.triggerComment?.body ?? "",
    "",
    "Please respond using your CONVERSATION MODE instructions.",
  ].join("\n");
}
```

**Step 4: Update `analyzeOrRemind` to accept and use `triggerContext`**

Find the current `analyzeOrRemind` signature:
```ts
async function analyzeOrRemind(
  result: CheckDescriptionResult,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig
): Promise<void> {
```

Replace with:
```ts
async function analyzeOrRemind(
  result: CheckDescriptionResult,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig,
  triggerContext?: TriggerContext
): Promise<void> {
```

Inside the `if (passed)` branch, find:
```ts
const agent = createTaskAnalyzerAgent(config, adapter);
await agent.generate(
  `Please analyze this task and produce either a Development Plan or Clarifying Questions.\n\nTask ID: ${taskId}\nTitle: ${task.title}\nDescription: ${task.description}`
);
```

Replace with:
```ts
const agent = createTaskAnalyzerAgent(config, adapter);
const userMessage =
  triggerContext?.triggerType === "comment"
    ? buildConversationPrompt(task, triggerContext)
    : buildAnalysisPrompt(task);
await agent.generate(userMessage);
```

**Step 5: Update `workflow.run` to accept and thread `triggerContext`**

Find:
```ts
return {
  async run(taskId: string): Promise<void> {
```

Replace with:
```ts
return {
  async run(taskId: string, triggerContext?: TriggerContext): Promise<void> {
```

Find the `analyzeOrRemind` call inside `run`:
```ts
await analyzeOrRemind(checkResult, adapter, config);
```

Replace with:
```ts
await analyzeOrRemind(checkResult, adapter, config, triggerContext);
```

**Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 7: Commit**

```bash
git add src/mastra/workflows/review-task.ts
git commit -m "feat: thread TriggerContext through workflow, add conversation prompt builder"
```

---

## Task 5: Update agent system prompt with CONVERSATION MODE

**Files:**
- Modify: `src/mastra/agents/task-analyzer.ts`

**Step 1: Read the current file**

Read `src/mastra/agents/task-analyzer.ts`. The `buildSystemPrompt` function currently ends with the `CLARIFYING QUESTIONS TEMPLATE` section followed by `.trim()`.

**Step 2: Add the `CONVERSATION MODE` section**

Find the end of the `CLARIFYING QUESTIONS TEMPLATE` section:
```ts
Once these are answered, I can write a full Development Plan.
\`\`\`
`.trim();
```

Replace with:
```ts
Once these are answered, I can write a full Development Plan.
\`\`\`

---

## CONVERSATION MODE

You enter this mode when the user message begins with "TASK:" and contains a "COMMENT THREAD" and a "TRIGGERING COMMENT" section.

Apply this decision logic in order:

1. **Read the TRIGGERING COMMENT** to understand what is being asked.

2. **If the triggering comment contains answers to your previous clarifying questions:**
   - Re-evaluate the task using ALL available information: the original description PLUS the answers given in the thread
   - If the task is NOW CLEAR → write a full Development Plan using the DEVELOPMENT PLAN TEMPLATE
   - If the task is STILL UNCLEAR → acknowledge what was answered, then ask ONLY the remaining unanswered questions (do not repeat answered ones)

3. **If the triggering comment asks a question about an existing Development Plan in the thread:**
   - Answer the question directly and concisely
   - End your response with: "Want me to update the Development Plan to incorporate this?"

4. **If the triggering comment asks a general question** (not about a plan, not answering clarifications):
   - Answer it directly in context of the project, task, and thread

5. **If the triggering comment does both** (provides answers AND asks a question):
   - Do both: process the answers (re-evaluate / write plan) AND answer the question

**Hard rules:**
- NEVER repeat a question that has already been answered in the thread
- NEVER re-post a Development Plan that already appears in the thread unless the user explicitly asks you to revise it
- ALWAYS use the full thread context when re-evaluating task clarity — answers given in comments count as part of the task spec
`.trim();
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/mastra/agents/task-analyzer.ts
git commit -m "feat: add CONVERSATION MODE section to agent system prompt"
```

---

## Task 6: Update `.env.example`

**Files:**
- Modify: `.env.example`

**Step 1: Read the current file**

Read `.env.example`. The GitHub section currently ends after `GITHUB_MENTION=@task-ai`.

**Step 2: Add `GITHUB_BOT_USERNAME` after the existing GitHub vars**

After the `GITHUB_MENTION` line, add:

```env
GITHUB_BOT_USERNAME=        # Optional: GitHub username of the bot account — prevents agent replying to its own comments
```

**Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add GITHUB_BOT_USERNAME to .env.example"
```

---

## Task 7: End-to-end verification

**Prerequisites:**
- Server running: `npm run dev`
- `.env` has `GITHUB_TOKEN` (bot account PAT), `GITHUB_BOT_USERNAME` set to the bot account username
- A real GitHub issue exists in a repo the bot has access to
- The issue has a previous bot comment with clarifying questions (or create one manually)

**Scenario 1 — Answering clarifying questions:**

1. On a GitHub issue where the bot previously asked questions, post a comment:
   ```
   @task-ai Here are my answers:
   1. The affected page is /dashboard/reports
   2. Only admin users need this feature
   3. The data comes from the /api/v2/reports endpoint
   ```
2. Watch server logs — expect:
   ```
   [GitHubAdapter] getComments("owner/repo#42")
   [GitHubAdapter] getTask("owner/repo#42")
   ```
3. Check the GitHub issue — the bot should post a Development Plan (if answers were sufficient) or follow-up questions (if still unclear)

**Scenario 2 — Question about the plan:**

1. On an issue where the bot posted a Dev Plan, comment:
   ```
   @task-ai What are the caching implications of the approach in step 2?
   ```
2. Bot should answer the specific question and end with "Want me to update the Development Plan to incorporate this?"

**Scenario 3 — Loop prevention:**

1. Ensure `GITHUB_BOT_USERNAME` is set in `.env`
2. Check server logs — when the bot posts its own comments, the webhook should fire but the server should return `{ status: "ignored" }` and log nothing further

**Scenario 4 — Label trigger unaffected:**

```bash
npm run test:github:label
```

Expected: same behavior as before — agent analyzes from scratch, no thread context.

**Scenario 5 — Test script for comment trigger (existing):**

```bash
npm run test:github:comment
```

This sends a realistic `issue_comment` payload with `@task-ai` in the body. Watch logs for `getComments` being called.

---

## Summary of files changed

| File | Change |
|---|---|
| `src/adapters/interface.ts` | Add `ThreadComment`, `TriggerContext` types |
| `src/adapters/github.ts` | Add `getComments(taskId)` + import `ThreadComment` |
| `src/server.ts` | Import `TriggerContext`, extend `handleTaskEvent` sig, extend payload type, loop prevention, thread fetch + TriggerContext build |
| `src/mastra/workflows/review-task.ts` | Import types, add `buildAnalysisPrompt` + `buildConversationPrompt`, thread `triggerContext?` through `run` + `analyzeOrRemind` |
| `src/mastra/agents/task-analyzer.ts` | Add `CONVERSATION MODE` section to system prompt |
| `.env.example` | Add `GITHUB_BOT_USERNAME` |
