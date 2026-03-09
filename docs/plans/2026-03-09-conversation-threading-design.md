# Conversation Threading Design

**Date:** 2026-03-09
**Status:** Approved

---

## Overview

Enable the agent to read the full GitHub comment thread and the triggering `@task-ai` comment when processing an `issue_comment` webhook, so it can answer questions, process clarifying-question answers, and offer to revise plans — rather than re-analyzing the issue from scratch every time.

---

## Trigger Behaviour

| Trigger | Thread fetched? | Agent mode |
|---|---|---|
| `issues.labeled` (label = trigger label) | No | Analysis mode (existing) |
| `issue_comment.created` (body contains mention) | Yes — full thread | Conversation mode (new) |

---

## Architecture: TriggerContext passed through call chain

```
issue_comment webhook fires
  → validate payload
  → loop prevention: sender.login === GITHUB_BOT_USERNAME? → 200 ignored
  → form taskId ("owner/repo#42")
  → send 202 immediately
  → (async inner try/catch):
      fetch per-repo config
      githubAdapter.getComments(taskId)
      build TriggerContext { triggerType, triggerComment, thread }
      handleTaskEvent(taskId, adapter, config, triggerContext)
        → workflow.run(taskId, triggerContext)
            → checkDescription(taskId)          [unchanged]
            → analyzeOrRemind(result, adapter, config, triggerContext)
                → label trigger → current behavior (plan or questions)
                → comment trigger → conversation-mode agent prompt
```

**Five files change. No new files.**

---

## New Types (`src/adapters/interface.ts`)

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

---

## New `GitHubAdapter` Method (`src/adapters/github.ts`)

```ts
async getComments(taskId: string): Promise<ThreadComment[]> {
  const { owner, repo, issueNumber } = this.parseTaskId(taskId);
  // TODO: switch to smart window (first bot comment + last N) when threads grow large
  const comments = await this.octokit.paginate(
    this.octokit.rest.issues.listComments,
    { owner, repo, issue_number: issueNumber, per_page: 100 }
  );
  return comments.map(c => ({
    author: c.user?.login ?? "unknown",
    body: c.body ?? "",
    createdAt: c.created_at,
  }));
}
```

`getComments` is NOT added to `ProjectManagerAdapter` — GitHub-specific only. Trello/Asana adapters need no changes.

---

## `server.ts` Changes

### Loop prevention

```ts
if (process.env.GITHUB_BOT_USERNAME &&
    payload.sender.login === process.env.GITHUB_BOT_USERNAME) {
  res.status(200).json({ status: "ignored" });
  return;
}
```

### Thread fetch + TriggerContext (inside inner try/catch, after 202)

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

### `handleTaskEvent` signature

```ts
async function handleTaskEvent(
  taskId: string,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig,
  triggerContext?: TriggerContext
): Promise<void>
```

Label trigger handler passes no `triggerContext` — zero changes to that path.

---

## `review-task.ts` Changes

`workflow.run` and `analyzeOrRemind` each gain `triggerContext?: TriggerContext`.

In `analyzeOrRemind`, when the task passes `checkDescription`:

```ts
const userMessage = triggerContext?.triggerType === "comment"
  ? buildConversationPrompt(task, triggerContext)
  : buildAnalysisPrompt(task);
await agent.generate(userMessage);
```

`buildAnalysisPrompt` extracts the current inline string. `buildConversationPrompt` is new.

### `buildConversationPrompt` output format

```
TASK:
ID: owner/repo#42
Title: [title]
Description: [body]

COMMENT THREAD (oldest first):
[alice] 2h ago: The dashboard loads slowly with 1000+ items.
[task-ai-bot] 1h ago: ## Clarifying Questions...
[alice] 5m ago: @task-ai Here are my answers: ...

TRIGGERING COMMENT (by alice):
@task-ai Here are my answers: 1. The /reports page...

Please respond using your CONVERSATION MODE instructions.
```

---

## `task-analyzer.ts` Changes

New `## CONVERSATION MODE` section added to the system prompt:

```
## CONVERSATION MODE

You enter this mode when the user message contains a THREAD and a TRIGGERING COMMENT.

Decision logic:

1. Read the TRIGGERING COMMENT to understand what is being asked.

2. If it contains ANSWERS to your previous clarifying questions:
   - Re-evaluate the task using the original description + all answers in the thread
   - If now CLEAR → write a full Development Plan (use DEVELOPMENT PLAN TEMPLATE)
   - If still UNCLEAR → acknowledge what was answered, ask ONLY remaining unanswered questions

3. If it asks a QUESTION about an existing Development Plan in the thread:
   - Answer directly and concisely
   - End with: "Want me to update the Development Plan to incorporate this?"

4. If it asks a GENERAL QUESTION:
   - Answer it in context of the project, task, and thread

5. If it does BOTH (answers + asks a question) → do both.

NEVER repeat questions already answered in the thread.
NEVER re-post a Development Plan that already appears in the thread unless explicitly asked to revise it.
```

---

## New Environment Variable

```env
GITHUB_BOT_USERNAME=task-ai-bot  # Optional: prevents agent replying to its own comments
```

---

## Files Changed

| File | Change |
|---|---|
| `src/adapters/interface.ts` | Add `ThreadComment`, `TriggerContext` types |
| `src/adapters/github.ts` | Add `getComments(taskId)` method |
| `src/server.ts` | Loop prevention, thread fetch, `TriggerContext` build, `handleTaskEvent` signature |
| `src/mastra/workflows/review-task.ts` | `triggerContext?` param, `buildAnalysisPrompt`/`buildConversationPrompt` split |
| `src/mastra/agents/task-analyzer.ts` | `CONVERSATION MODE` section in system prompt |
| `.env.example` | Add `GITHUB_BOT_USERNAME` |

---

## What Is NOT in Scope

- Smart window (first bot comment + last N) — marked as TODO in `getComments`
- Trello/Asana comment threading — label trigger path is unchanged
- Webhook signature verification — existing TODO
- Conversation history persistence across sessions
