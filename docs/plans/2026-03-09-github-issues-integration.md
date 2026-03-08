# GitHub Issues Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real GitHub Issues support — triggered by a label or `@task-ai` mention — with per-repo config fetched from `.github/task-ai.md`.

**Architecture:** A new `GitHubAdapter` implementing the existing `ProjectManagerAdapter` interface uses `@octokit/rest` for all GitHub API calls. A `/webhook/github` endpoint in `server.ts` handles two GitHub event types (`issues.labeled`, `issue_comment.created`), extracts `owner/repo#issueNumber` as the composite taskId, fetches per-repo config from `.github/task-ai.md` (YAML frontmatter → `ProjectConfig`), then delegates to the existing `handleTaskEvent` workflow. The markdown body of the config file is left for Phase 2 RAG.

**Tech Stack:** `@octokit/rest` (GitHub API), `gray-matter` (YAML frontmatter parsing), TypeScript, Express, existing Mastra workflow.

**Design doc:** `docs/plans/2026-03-09-github-issues-integration-design.md`

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install `@octokit/rest` and `gray-matter`**

```bash
npm install @octokit/rest gray-matter
npm install --save-dev @types/gray-matter
```

**Step 2: Verify they appear in `package.json` dependencies**

```bash
grep -E "octokit|gray-matter" package.json
```

Expected output:
```
"@octokit/rest": "^21.x.x",
"gray-matter": "^4.x.x",
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install @octokit/rest and gray-matter for GitHub integration"
```

---

## Task 2: Extend `AdapterSource` type

**Files:**
- Modify: `src/adapters/interface.ts:1`

**Step 1: Add `"github"` to the union**

In `src/adapters/interface.ts`, change line 2:

```ts
// Before
export type AdapterSource = "trello" | "asana";

// After
export type AdapterSource = "trello" | "asana" | "github";
```

**Step 2: Verify TypeScript is happy**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/adapters/interface.ts
git commit -m "feat: add 'github' to AdapterSource union type"
```

---

## Task 3: Create `GitHubAdapter` — skeleton + `parseTaskId`

**Files:**
- Create: `src/adapters/github.ts`

**Step 1: Create the file with constructor and private `parseTaskId` helper**

```ts
import { Octokit } from "@octokit/rest";
import { ProjectManagerAdapter, Task, TaskStatus } from "./interface";

export class GitHubAdapter implements ProjectManagerAdapter {
  source = "github" as const;

  private octokit: Octokit;
  readonly triggerLabel: string;
  readonly mention: string;

  constructor(token: string, triggerLabel: string, mention: string) {
    this.octokit = new Octokit({ auth: token });
    this.triggerLabel = triggerLabel;
    this.mention = mention;
  }

  private parseTaskId(taskId: string): { owner: string; repo: string; issueNumber: number } {
    // Format: "owner/repo#123"
    const match = taskId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (!match) {
      throw new Error(`[GitHubAdapter] Invalid taskId format: "${taskId}". Expected "owner/repo#123"`);
    }
    return { owner: match[1], repo: match[2], issueNumber: parseInt(match[3], 10) };
  }

  async getTask(_taskId: string): Promise<Task> {
    throw new Error("Not implemented");
  }

  async addComment(_taskId: string, _comment: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async setStatus(_taskId: string, _status: TaskStatus): Promise<void> {
    throw new Error("Not implemented");
  }
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/adapters/github.ts
git commit -m "feat: add GitHubAdapter skeleton with parseTaskId"
```

---

## Task 4: Implement `getTask`

**Files:**
- Modify: `src/adapters/github.ts`

**Step 1: Replace the `getTask` stub with the real implementation**

```ts
async getTask(taskId: string): Promise<Task> {
  console.log(`[GitHubAdapter] getTask("${taskId}")`);
  const { owner, repo, issueNumber } = this.parseTaskId(taskId);

  const { data: issue } = await this.octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  return {
    id: taskId,
    title: issue.title,
    description: issue.body ?? "",
    assignee: issue.assignee?.login ?? null,
    labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
    url: issue.html_url,
    source: "github",
    metadata: {
      owner,
      repo,
      issueNumber,
      state: issue.state,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
    },
  };
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/adapters/github.ts
git commit -m "feat: implement GitHubAdapter.getTask via Octokit REST"
```

---

## Task 5: Implement `addComment`

**Files:**
- Modify: `src/adapters/github.ts`

**Step 1: Replace the `addComment` stub**

```ts
async addComment(taskId: string, comment: string): Promise<void> {
  console.log(`[GitHubAdapter] addComment("${taskId}", "${comment.substring(0, 80)}...")`);
  const { owner, repo, issueNumber } = this.parseTaskId(taskId);

  await this.octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  });

  console.log(`[GitHubAdapter] Comment posted to ${taskId}`);
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/adapters/github.ts
git commit -m "feat: implement GitHubAdapter.addComment"
```

---

## Task 6: Implement `setStatus`

**Files:**
- Modify: `src/adapters/github.ts`

**Step 1: Replace the `setStatus` stub**

The status is expressed by adding a label and removing the conflicting one. Labels must already exist in the repo.

```ts
async setStatus(taskId: string, status: TaskStatus): Promise<void> {
  console.log(`[GitHubAdapter] setStatus("${taskId}", "${status}")`);
  const { owner, repo, issueNumber } = this.parseTaskId(taskId);

  const labelToAdd = status === "needs_clarification" ? "needs-clarification" : "ready-for-dev";
  const labelToRemove = status === "needs_clarification" ? "ready-for-dev" : "needs-clarification";

  // Add the new label
  await this.octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels: [labelToAdd],
  });

  // Remove the conflicting label — ignore 404 (label wasn't on the issue)
  try {
    await this.octokit.rest.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: labelToRemove,
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err;
  }

  console.log(`[GitHubAdapter] Label "${labelToAdd}" added to ${taskId}`);
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/adapters/github.ts
git commit -m "feat: implement GitHubAdapter.setStatus via GitHub labels"
```

---

## Task 7: Implement `fetchRepoConfig`

**Files:**
- Modify: `src/adapters/github.ts`

This method fetches `.github/task-ai.md` from the repo, parses the YAML frontmatter into a `ProjectConfig`, and falls back to `defaultProjectConfig` if the file is missing or unparseable. The markdown body is ignored in Phase 1 (reserved for RAG).

**Step 1: Add import at top of file**

```ts
import matter from "gray-matter";
import { ProjectConfig, defaultProjectConfig } from "../config/project";
```

**Step 2: Add `fetchRepoConfig` as a public method on `GitHubAdapter`**

```ts
async fetchRepoConfig(owner: string, repo: string): Promise<ProjectConfig> {
  try {
    const { data: fileData } = await this.octokit.rest.repos.getContent({
      owner,
      repo,
      path: ".github/task-ai.md",
    });

    if (Array.isArray(fileData) || fileData.type !== "file") {
      console.warn(`[GitHubAdapter] .github/task-ai.md is not a file in ${owner}/${repo}, using default config`);
      return defaultProjectConfig;
    }

    const content = Buffer.from(fileData.content, "base64").toString("utf8");
    const { data: frontmatter } = matter(content);

    return {
      name: frontmatter.name ?? `${owner}/${repo}`,
      techStack: frontmatter.techStack ?? defaultProjectConfig.techStack,
      conventions: frontmatter.conventions ?? defaultProjectConfig.conventions,
      reviewCriteria: {
        minDescriptionLength:
          frontmatter.reviewCriteria?.minDescriptionLength ??
          defaultProjectConfig.reviewCriteria.minDescriptionLength,
        requiredFields:
          frontmatter.reviewCriteria?.requiredFields ??
          defaultProjectConfig.reviewCriteria.requiredFields,
      },
      knowledge: { enabled: false }, // Phase 2: parse body for RAG
    };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      console.warn(`[GitHubAdapter] .github/task-ai.md not found in ${owner}/${repo}, using default config`);
    } else {
      console.error(`[GitHubAdapter] Failed to fetch repo config for ${owner}/${repo}:`, err);
    }
    return defaultProjectConfig;
  }
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/adapters/github.ts
git commit -m "feat: implement GitHubAdapter.fetchRepoConfig from .github/task-ai.md"
```

---

## Task 8: Add `/webhook/github` endpoint to `server.ts`

**Files:**
- Modify: `src/server.ts`

**Step 1: Add imports at the top of `server.ts` (after existing imports)**

```ts
import { GitHubAdapter } from "./adapters/github";
```

**Step 2: Instantiate `GitHubAdapter` alongside Trello/Asana adapters (top of file)**

```ts
const githubAdapter = process.env.GITHUB_TOKEN
  ? new GitHubAdapter(
      process.env.GITHUB_TOKEN,
      process.env.GITHUB_TRIGGER_LABEL ?? "ai-review",
      process.env.GITHUB_MENTION ?? "@task-ai"
    )
  : null;
```

**Step 3: Add the `/webhook/github` handler inside `createServer()`, after the Asana handler**

```ts
// GitHub webhook
app.post("/webhook/github", async (req: Request, res: Response) => {
  // TODO: verify X-Hub-Signature-256
  if (!githubAdapter) {
    res.status(503).json({ error: "GitHub integration not configured (missing GITHUB_TOKEN)" });
    return;
  }

  const event = req.headers["x-github-event"] as string | undefined;

  try {
    if (event === "issues") {
      const payload = req.body as {
        action: string;
        label?: { name: string };
        issue: { number: number };
        repository: { name: string; owner: { login: string } };
      };

      if (payload.action !== "labeled" || payload.label?.name !== githubAdapter.triggerLabel) {
        res.status(200).json({ status: "ignored" });
        return;
      }

      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      const taskId = `${owner}/${repo}#${payload.issue.number}`;
      const config = await githubAdapter.fetchRepoConfig(owner, repo);

      res.status(202).json({ status: "accepted", taskId });
      await handleTaskEvent(taskId, githubAdapter, config);

    } else if (event === "issue_comment") {
      const payload = req.body as {
        action: string;
        comment: { body: string };
        issue: { number: number };
        repository: { name: string; owner: { login: string } };
      };

      if (
        payload.action !== "created" ||
        !payload.comment.body.includes(githubAdapter.mention)
      ) {
        res.status(200).json({ status: "ignored" });
        return;
      }

      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      const taskId = `${owner}/${repo}#${payload.issue.number}`;
      const config = await githubAdapter.fetchRepoConfig(owner, repo);

      res.status(202).json({ status: "accepted", taskId });
      await handleTaskEvent(taskId, githubAdapter, config);

    } else {
      res.status(200).json({ status: "ignored" });
    }
  } catch (error) {
    console.error("[Server] Error processing GitHub webhook:", error);
  }
});
```

**Step 4: Update the `/health` endpoint to include github**

```ts
// Before
res.json({ status: "ok", adapters: ["trello", "asana"] });

// After
res.json({ status: "ok", adapters: ["trello", "asana", ...(githubAdapter ? ["github"] : [])] });
```

**Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 6: Commit**

```bash
git add src/server.ts
git commit -m "feat: add /webhook/github endpoint handling issues.labeled and issue_comment.created"
```

---

## Task 9: Validate `GITHUB_TOKEN` at startup + update logging

**Files:**
- Modify: `src/index.ts`

**Step 1: Add optional GitHub token warning after the `ANTHROPIC_API_KEY` check**

After the existing `ANTHROPIC_API_KEY` check (around line 4), add:

```ts
if (!process.env.GITHUB_TOKEN) {
  console.warn(
    "[Agent] WARNING: GITHUB_TOKEN is not set. GitHub Issues integration will be disabled.\n" +
    "Set GITHUB_TOKEN in .env to enable it."
  );
}
```

Note: This is a warning, not `process.exit(1)` — the agent can still serve Trello/Asana without GitHub.

**Step 2: Update the startup log to include the GitHub webhook URL**

After the existing webhook log lines (around line 42), add:

```ts
if (process.env.GITHUB_TOKEN) {
  console.log(`  POST http://localhost:${PORT}/webhook/github`);
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: warn on missing GITHUB_TOKEN and log GitHub webhook URL at startup"
```

---

## Task 10: Update `.env.example`

**Files:**
- Modify: `.env.example`

**Step 1: Open `.env.example` and add the new variables**

After the existing `PORT=3000` line, add:

```env
# GitHub Issues integration (real API)
GITHUB_TOKEN=            # Required for GitHub: PAT with repo/public_repo scope
GITHUB_TRIGGER_LABEL=ai-review  # Label that triggers analysis (default: ai-review)
GITHUB_MENTION=@task-ai         # Mention keyword in comments (default: @task-ai)

# Phase 2 — not yet used
# TRELLO_API_KEY=
# TRELLO_TOKEN=
# ASANA_TOKEN=
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add GITHUB_TOKEN env vars to .env.example"
```

---

## Task 11: Create test scripts

**Files:**
- Create: `scripts/test-github-label.ts`
- Create: `scripts/test-github-comment.ts`
- Modify: `package.json`

These scripts send realistic GitHub webhook payloads to the local server. They use a real `owner/repo/issue_number` you configure via env vars, so the agent will actually call the GitHub API.

**Step 1: Create `scripts/test-github-label.ts`**

```ts
/**
 * Simulates a GitHub "issues.labeled" webhook event.
 *
 * Usage:
 *   TEST_OWNER=my-org TEST_REPO=my-repo TEST_ISSUE=42 npx ts-node scripts/test-github-label.ts
 *
 * Requires: server running on PORT (default 3000), GITHUB_TOKEN set in .env
 */
const PORT = process.env.PORT ?? "3000";
const OWNER = process.env.TEST_OWNER ?? "octocat";
const REPO = process.env.TEST_REPO ?? "Hello-World";
const ISSUE = parseInt(process.env.TEST_ISSUE ?? "1", 10);
const LABEL = process.env.GITHUB_TRIGGER_LABEL ?? "ai-review";

const payload = {
  action: "labeled",
  label: { name: LABEL },
  issue: {
    number: ISSUE,
    title: "Test issue title",
    body: "Test issue body",
    html_url: `https://github.com/${OWNER}/${REPO}/issues/${ISSUE}`,
    assignee: null,
    labels: [{ name: LABEL }],
    state: "open",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  repository: {
    name: REPO,
    owner: { login: OWNER },
  },
  sender: { login: "test-user" },
};

fetch(`http://localhost:${PORT}/webhook/github`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-GitHub-Event": "issues",
  },
  body: JSON.stringify(payload),
})
  .then((r) => r.json())
  .then((data) => console.log("[test:github:label] Response:", data))
  .catch((err) => console.error("[test:github:label] Error:", err));
```

**Step 2: Create `scripts/test-github-comment.ts`**

```ts
/**
 * Simulates a GitHub "issue_comment.created" webhook event with @task-ai mention.
 *
 * Usage:
 *   TEST_OWNER=my-org TEST_REPO=my-repo TEST_ISSUE=42 npx ts-node scripts/test-github-comment.ts
 *
 * Requires: server running on PORT (default 3000), GITHUB_TOKEN set in .env
 */
const PORT = process.env.PORT ?? "3000";
const OWNER = process.env.TEST_OWNER ?? "octocat";
const REPO = process.env.TEST_REPO ?? "Hello-World";
const ISSUE = parseInt(process.env.TEST_ISSUE ?? "1", 10);
const MENTION = process.env.GITHUB_MENTION ?? "@task-ai";

const payload = {
  action: "created",
  comment: {
    body: `${MENTION} please analyze this issue and create a dev plan.`,
    html_url: `https://github.com/${OWNER}/${REPO}/issues/${ISSUE}#issuecomment-test`,
  },
  issue: {
    number: ISSUE,
    title: "Test issue title",
    html_url: `https://github.com/${OWNER}/${REPO}/issues/${ISSUE}`,
  },
  repository: {
    name: REPO,
    owner: { login: OWNER },
  },
  sender: { login: "test-user" },
};

fetch(`http://localhost:${PORT}/webhook/github`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-GitHub-Event": "issue_comment",
  },
  body: JSON.stringify(payload),
})
  .then((r) => r.json())
  .then((data) => console.log("[test:github:comment] Response:", data))
  .catch((err) => console.error("[test:github:comment] Error:", err));
```

**Step 3: Add scripts to `package.json`**

```json
"test:github:label": "TEST_OWNER=octocat TEST_REPO=Hello-World TEST_ISSUE=1 npx ts-node scripts/test-github-label.ts",
"test:github:comment": "TEST_OWNER=octocat TEST_REPO=Hello-World TEST_ISSUE=1 npx ts-node scripts/test-github-comment.ts"
```

Replace `octocat/Hello-World/1` with a real repo and issue number where the token has access.

**Step 4: Commit**

```bash
git add scripts/ package.json
git commit -m "feat: add test:github:label and test:github:comment scripts"
```

---

## Task 12: End-to-end verification

**Prerequisites:**
- `.env` has `GITHUB_TOKEN`, pointing to a real PAT with `repo` scope
- A real GitHub repo where the token has write access
- Issue labels `needs-clarification` and `ready-for-dev` created in that repo
- Either a `.github/task-ai.md` file in the repo, or rely on the default config

**Step 1: Start the server**

```bash
npm run dev
```

Expected output includes:
```
[Agent] Webhooks:
  POST http://localhost:3000/webhook/trello
  POST http://localhost:3000/webhook/asana
  POST http://localhost:3000/webhook/github
```

**Step 2: Test label trigger**

Edit `package.json` test scripts to point to your repo, then:

```bash
npm run test:github:label
```

Expected: `{ status: "accepted", taskId: "owner/repo#N" }`

Watch server logs for:
```
[GitHubAdapter] getTask("owner/repo#N")
[GitHubAdapter] addComment(...)
[GitHubAdapter] setStatus(...)
```

**Step 3: Test comment trigger**

```bash
npm run test:github:comment
```

Expected: `{ status: "accepted", taskId: "owner/repo#N" }`

**Step 4: Check the real GitHub issue** — it should have a new comment from the agent and a label (`needs-clarification` or `ready-for-dev`).

**Step 5: Test ignored event**

```bash
curl -X POST http://localhost:3000/webhook/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -d '{}'
```

Expected: `{ status: "ignored" }`

---

## Pre-repo Label Setup (one-time, per repo)

Before end-to-end testing, create these labels in the target GitHub repo:

```bash
# Using gh CLI
gh label create "ai-review" --color "0075ca" --description "Trigger AI task analysis" --repo owner/repo
gh label create "needs-clarification" --color "e4e669" --description "AI: needs clarification" --repo owner/repo
gh label create "ready-for-dev" --color "0e8a16" --description "AI: ready for development" --repo owner/repo
```

---

## Summary of files changed

| File | Action |
|---|---|
| `package.json` | Add `@octokit/rest`, `gray-matter`, 2 test scripts |
| `src/adapters/interface.ts` | Add `"github"` to `AdapterSource` |
| `src/adapters/github.ts` | CREATE: full `GitHubAdapter` |
| `src/server.ts` | Add `/webhook/github` handler, instantiate `GitHubAdapter` |
| `src/index.ts` | Add `GITHUB_TOKEN` warning + log GitHub webhook URL |
| `.env.example` | Add `GITHUB_TOKEN`, `GITHUB_TRIGGER_LABEL`, `GITHUB_MENTION` |
| `scripts/test-github-label.ts` | CREATE: test script |
| `scripts/test-github-comment.ts` | CREATE: test script |
