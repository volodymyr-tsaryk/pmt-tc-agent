# GitHub Issues Integration Design

**Date:** 2026-03-09
**Status:** Approved

---

## Overview

Add real GitHub Issues support to the task analyzer agent. Unlike the existing Trello/Asana adapters (which are mocks), this is a live integration using the GitHub REST API via `@octokit/rest`.

---

## Triggers

The agent runs when either of the following GitHub events is received at `POST /webhook/github`:

| GitHub Event | Condition |
|---|---|
| `issues` (action: `labeled`) | Added label matches `GITHUB_TRIGGER_LABEL` |
| `issue_comment` (action: `created`) | Comment body contains `GITHUB_MENTION` |

All other events/actions receive `200 { status: "ignored" }` (required to prevent GitHub retries).

**Default values:**
- `GITHUB_TRIGGER_LABEL`: `ai-review`
- `GITHUB_MENTION`: `@task-ai`

---

## Authentication

Personal Access Token (PAT) via `GITHUB_TOKEN` env var. The token must have `repo` scope (for private repos) or `public_repo` scope (for public repos). The Octokit client is instantiated once and shared across all webhook requests.

---

## Adapter: `GitHubAdapter`

**File:** `src/adapters/github.ts`

### Constructor

```ts
new GitHubAdapter(token: string, triggerLabel: string, mention: string)
```

### taskId format

Composite string: `"owner/repo#issueNumber"` (e.g., `"acme/backend#42"`).
All three adapter methods parse this format to extract `owner`, `repo`, and `issueNumber`.

### Method implementations

| Method | GitHub API call |
|---|---|
| `getTask(taskId)` | `GET /repos/{owner}/{repo}/issues/{number}` |
| `addComment(taskId, text)` | `POST /repos/{owner}/{repo}/issues/{number}/comments` |
| `setStatus(taskId, status)` | Add label + remove conflicting label |

### Status → Label mapping

| `TaskStatus` | Label added | Label removed |
|---|---|---|
| `needs_clarification` | `needs-clarification` | `ready-for-dev` |
| `ready_for_dev` | `ready-for-dev` | `needs-clarification` |

Labels must be pre-created in each repo. If a label is missing GitHub returns 422 — the adapter logs and rethrows.

### Task mapping (GitHub Issue → `Task`)

```ts
{
  id:          "owner/repo#issueNumber",
  title:       issue.title,
  description: issue.body ?? "",
  assignee:    issue.assignee?.login ?? null,
  labels:      issue.labels.map(l => l.name),
  url:         issue.html_url,
  source:      "github",
  metadata:    { owner, repo, issueNumber, state, createdAt, updatedAt }
}
```

---

## Per-Repo Configuration: `.github/task-ai.md`

Each repo that sends webhooks to this agent must contain a `.github/task-ai.md` file. This file serves two purposes:

1. **Phase 1 (now):** YAML frontmatter is parsed into `ProjectConfig`, replacing `defaultProjectConfig` for that repo.
2. **Phase 2 (RAG, stubbed in `rag.ts`):** The markdown body is the knowledge corpus for retrieval-augmented generation.

### File format

```markdown
---
techStack: [Next.js 14, TypeScript, PostgreSQL, Prisma ORM]
conventions:
  - Feature-based folder structure (src/features/<feature>/)
  - Server components by default
triggerLabel: ai-review
mention: "@task-ai"
reviewCriteria:
  minDescriptionLength: 50
  requiredFields: [title, description]
---

# Project Documentation

Free-form markdown describing the project architecture, key decisions,
domain concepts, and any context the AI agent should know when analyzing issues.

## Architecture
...

## Key Decisions
...
```

### Fetching

The adapter fetches `.github/task-ai.md` via `GET /repos/{owner}/{repo}/contents/.github/task-ai.md` at the start of each `handleTaskEvent` call. If the file is missing, `defaultProjectConfig` is used as fallback.

---

## Webhook Handler

**Endpoint:** `POST /webhook/github`

```
X-GitHub-Event: issues
  → action === "labeled" AND label.name === GITHUB_TRIGGER_LABEL
  → extract owner, repo, issue.number
  → handleTaskEvent("owner/repo#123", githubAdapter, repoConfig)

X-GitHub-Event: issue_comment
  → action === "created" AND comment.body includes GITHUB_MENTION
  → extract owner, repo, issue.number
  → handleTaskEvent("owner/repo#123", githubAdapter, repoConfig)

anything else → 200 { status: "ignored" }
```

Response pattern: `202 Accepted` immediately, process async (same as Trello/Asana).

---

## Interface Changes

**`src/adapters/interface.ts`**

```ts
// Before
export type AdapterSource = "trello" | "asana";

// After
export type AdapterSource = "trello" | "asana" | "github";
```

---

## New Environment Variables

```env
GITHUB_TOKEN           # required — PAT with repo/public_repo scope
GITHUB_TRIGGER_LABEL   # optional, default: "ai-review"
GITHUB_MENTION         # optional, default: "@task-ai"
```

`GITHUB_TOKEN` absence is caught at startup with `process.exit(1)` (same pattern as `ANTHROPIC_API_KEY`). The other two are optional with defaults applied in `server.ts`.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `GITHUB_TOKEN` missing | `process.exit(1)` at startup |
| `.github/task-ai.md` missing | Fall back to `defaultProjectConfig`, log warning |
| Issue not found (404) | Throw — workflow catches and logs |
| Label doesn't exist (422) | Log error, rethrow |
| Rate limit hit (403/429) | Log error, rethrow (no retry — matches existing pattern) |
| Unknown event/action | `200 { status: "ignored" }` |

---

## New Dependency

```
@octokit/rest   — official GitHub REST client
```

---

## Test Scripts

Two new npm scripts for manual testing without real GitHub webhooks:

```bash
npm run test:github:label    # POST issues.labeled payload to /webhook/github
npm run test:github:comment  # POST issue_comment.created with @task-ai mention
```

These send realistic GitHub webhook payloads (with correct headers including `X-GitHub-Event`) to `localhost:PORT`.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/adapters/github.ts` | CREATE — GitHubAdapter |
| `src/adapters/interface.ts` | MODIFY — add `"github"` to AdapterSource |
| `src/server.ts` | MODIFY — add `/webhook/github` handler, fetch per-repo config |
| `src/index.ts` | MODIFY — log new webhook URL, validate `GITHUB_TOKEN` |
| `.env.example` | MODIFY — add new env vars |
| `package.json` | MODIFY — add `@octokit/rest` |
| `scripts/test-github-label.ts` | CREATE — test script |
| `scripts/test-github-comment.ts` | CREATE — test script |

---

## What Is NOT in Scope

- Webhook signature verification (`X-Hub-Signature-256`) — TODO, same as Trello/Asana
- RAG body parsing from `.github/task-ai.md` — Phase 2
- Pagination for repos with many labels
- Retry logic on failure
